/**
 * App shell / gate ordering, mirroring the web app's App.tsx flow:
 *   auth gate → vault-meta gate → lock gate → Shell.
 */
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { watchAuth, signOut } from '@/auth/session.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { useUiStore } from '@/stores/uiStore.js';
import { armAutoLock, lockNow, disarmAutoLock } from '@/lib/autoLock.js';
import { listen, emit } from '@/auth/bridge.js';
import { bridge } from '@/auth/bridge.js';
import { ensureAuthReady } from '@/backend/firebase.js';
import { searchItems } from '@/lib/search.js';

import SignInScreen from './screens/SignInScreen.js';
import UnlockScreen from './screens/UnlockScreen.js';
import NoVaultScreen from './screens/NoVaultScreen.js';
import Shell from './Shell.js';

type AuthPhase = 'booting' | 'signedOut' | 'signedIn';

/**
 * Resolve the popup's requested value on demand. Runs only in the main
 * window; the plaintext crosses the clipboard boundary, never the event bus.
 * Returns '' when the requested optional field is absent (e.g. no key PEM).
 */
async function resolveQuickCopyValue(id: string, kind: string, field: string): Promise<string> {
  const ds = useDataStore.getState();
  switch (kind) {
    case 'secret':
      return (await ds.decryptSecretById(id)).value;
    case 'password': {
      const dec = await ds.decryptPasswordById(id);
      return field === 'secondary' ? dec.username : dec.password;
    }
    case 'ssh':
      return field === 'secondary' ? await ds.decryptSshPublic(id) : await ds.decryptSshPrivate(id);
    case 'totp':
      return (await ds.totpCodeFor(id)).code;
    case 'cert': {
      const dec = await ds.decryptCertById(id);
      return field === 'secondary' ? dec.keyPem ?? '' : dec.certPem;
    }
    default:
      throw new Error('Unknown item type');
  }
}

export default function App() {
  const [authPhase, setAuthPhase] = useState<AuthPhase>('booting');
  const [user, setUser] = useState<User | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [hasMeta, setHasMeta] = useState<boolean | null>(null);
  const lockPhase = useVaultStore((s) => s.lockPhase);

  // Auth listener + uid hand-off (uid feeds key derivation — must match web).
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let disposed = false;

    ensureAuthReady()
      .then(() => {
        if (disposed) return;
        unsub = watchAuth((u) => {
          setAuthPhase(u ? 'signedIn' : 'signedOut');
          setUser((prev) => {
            if (prev && !u) {
              // Sign-out: forget everything sensitive.
              useVaultStore.getState().clearSession();
              useDataStore.getState().unsubscribeAll();
              useDataStore.getState().clearAll();
            }
            if (prev?.uid !== u?.uid) {
              useVaultStore.getState().clearSession();
              useDataStore.getState().unsubscribeAll();
              useDataStore.getState().clearAll();
            }
            return u;
          });
          if (!u) {
            setHasMeta(null);
            setUserError(null);
          }
        });
      })
      .catch((e) => {
        setUserError(e instanceof Error ? e.message : String(e));
        setAuthPhase('signedOut');
      });

    return () => {
      disposed = true;
      unsub?.();
    };
  }, []);

  // Vault-meta gate: decide unlock vs no-vault message.
  useEffect(() => {
    if (!user) return;
    useVaultStore.getState().setUid(user.uid);
    useVaultStore
      .getState()
      .loadVaultMeta(user.uid)
      .then(setHasMeta);
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscriptions live once the vault unlocks; die on lock.
  useEffect(() => {
    if (lockPhase === 'unlocked' && user) {
      const stop = useDataStore.getState().subscribeAll(user.uid);
      return stop;
    }
    if (lockPhase === 'locked') {
      useDataStore.getState().unsubscribeAll();
    }
  }, [lockPhase, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tray "Lock now" hotkey event.
  useEffect(() => {
    const stop = listen<{ reason: string }>('tray:lock', () => lockNow('tray'));
    return () => void stop.then((f) => f());
  }, []);

  // ─── Quick popup answering (this window holds the vault; the popup never
  // sees plaintext) ───
  useEffect(() => {
    const stops = [
      listen<{ q: string }>('quick:query', ({ q }) => {
        const phase = useVaultStore.getState().lockPhase;
        const locked = phase !== 'unlocked';
        void emit('quick:results', {
          items: locked ? [] : searchItems(useDataStore.getState().metaIndex(), q),
          locked,
          ready: true,
        });
      }),
      listen<{ id: string; kind: string; field: string }>('quick:copy', ({ id, kind, field }) => {
        void (async () => {
          try {
            const value = await resolveQuickCopyValue(id, kind, field);
            if (!value) throw new Error('Nothing to copy for that field');
            const secs = useUiStore.getState().settings.clipboardClearSecs ?? 20;
            await bridge.copySecret(value, secs);
            await emit('quick:copy-result', { ok: true, message: 'Copied to clipboard', clearSecs: secs });
          } catch (e) {
            await emit('quick:copy-result', {
              ok: false,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      }),
    ];
    return () => {
      for (const s of stops) void s.then((f) => f());
    };
  }, []);

  // Manual lock via Cmd/Ctrl+L; Sign-out hotkey none (UI only).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lockNow('manual');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Settings + auto-lock armed only while unlocked.
  useEffect(() => {
    void useUiStore.getState().reloadSettings();
    if (lockPhase === 'unlocked') {
      armAutoLock();
      return disarmAutoLock;
    }
  }, [lockPhase]);

  // Meta refresh after returning from web setup: re-check on window focus.
  useEffect(() => {
    if (!user || hasMeta !== false) return;
    const onFocus = () => {
      useVaultStore.getState().loadVaultMeta(user.uid).then(setHasMeta);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, hasMeta]);

  if (authPhase === 'booting') {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <div className="font-display text-lg font-bold tracking-tight">SCYNC</div>
          <div className="mono-label mt-2">starting…</div>
          {userError && <div className="text-xs text-rose-400 mt-3 max-w-sm">{userError}</div>}
        </div>
      </div>
    );
  }

  if (authPhase === 'signedOut' || !user) {
    return <SignInScreen />;
  }

  if (hasMeta === false) {
    return <NoVaultScreen email={user.email ?? ''} onSignOut={() => signOut()} />;
  }

  if (lockPhase !== 'unlocked') {
    return (
      <UnlockScreen
        email={user.email ?? ''}
        onSignOut={() => signOut()}
        unlocking={lockPhase === 'unlocking'}
      />
    );
  }

  return <Shell user={user} onSignOut={() => signOut()} />;
}
