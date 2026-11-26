/**
 * vaultStore — the heart of the lock model.
 *
 * The derived key is a non-extractable CryptoKey living ONLY here, in the
 * main window's JS memory. It is never persisted, logged, or sent across
 * windows. Plaintext never lives in this store: decryption happens on demand
 * via `decryptX` helpers and reveal/copy flows.
 */
import { create } from 'zustand';
import {
  getVaultMeta,
  deriveKey,
  checkVerifier,
  type VaultMeta,
} from '@/backend/index.js';
import { bridge } from '@/auth/bridge.js';
import { useUiStore } from './uiStore.js';

export type LockPhase = 'locked' | 'unlocking' | 'unlocked';

/** Exponential backoff after 5 failed attempts (client-side rate limit). */
export const MAX_ATTEMPTS_BEFORE_DELAY = 5;

export function retryDelayMs(attempt: number): number {
  // attempt = failed-attempt count. 0..4 → 0 ms; then 1, 2, 4, 8, … seconds, capped at 60s.
  if (attempt < MAX_ATTEMPTS_BEFORE_DELAY) return 0;
  const exp = Math.min(60_000, 1_000 * 2 ** (attempt - MAX_ATTEMPTS_BEFORE_DELAY + 1));
  return exp;
}

interface VaultState {
  uid: string | null;
  derivedKey: CryptoKey | null;
  vaultMeta: VaultMeta | null;
  lockPhase: LockPhase;
  /** Why the vault last locked, for a gentle explanation on the unlock screen. */
  lockReason: string | null;
  /** Failed unlock attempts since last success (drives rate limiting). */
  failedAttempts: number;
  /** Wall-clock time when the next attempt is allowed (rate limiting). */
  nextAttemptAllowedAt: number;
  error: string | null;

  setUid: (uid: string | null) => void;
  loadVaultMeta: (uid: string) => Promise<boolean>;
  unlock: (password: string, opts?: { viaBiometric?: boolean }) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  lock: (opts?: { silent?: boolean; reason?: string }) => void;
  clearSession: () => void;
  isVaultReady: () => boolean;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  uid: null,
  derivedKey: null,
  vaultMeta: null,
  lockPhase: 'locked',
  lockReason: null,
  failedAttempts: 0,
  nextAttemptAllowedAt: 0,
  error: null,

  setUid: (uid) => set({ uid }),

  loadVaultMeta: async (uid) => {
    try {
      const meta = await getVaultMeta(uid);
      set({ vaultMeta: meta, error: null });
      return meta !== null;
    } catch (e) {
      set({ vaultMeta: null, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  /**
   * Unlock = getVaultMeta → deriveKey(password, uid, salt) → checkVerifier.
   * PBKDF2 runs in the webview's WebCrypto (async, off the UI thread).
   */
  unlock: async (password, opts) => {
    const state = get();
    if (!state.uid) {
      set({ error: 'No signed-in user.' });
      return false;
    }
    if (Date.now() < state.nextAttemptAllowedAt) {
      const wait = Math.ceil((state.nextAttemptAllowedAt - Date.now()) / 1000);
      set({ error: `Too many attempts. Wait ${wait}s and try again.` });
      return false;
    }

    set({ lockPhase: 'unlocking', error: null });
    try {
      let meta = state.vaultMeta;
      if (!meta || state.uid) {
        const fresh = await getVaultMeta(state.uid);
        if (fresh) meta = fresh;
      }
      if (!meta) {
        set({
          lockPhase: 'locked',
          error: 'Vault is not initialized. Please set up your vault on the Scync web app first.',
        });
        return false;
      }

      const key = await deriveKey(password, state.uid, meta.salt);
      const ok = await checkVerifier(key, meta.verifier);
      if (!ok) {
        const attempts = state.failedAttempts + 1;
        set({
          lockPhase: 'locked',
          failedAttempts: attempts,
          nextAttemptAllowedAt: Date.now() + retryDelayMs(attempts),
          error: 'Incorrect master password.',
        });
        return false;
      }

      set({
        derivedKey: key,
        vaultMeta: meta,
        lockPhase: 'unlocked',
        failedAttempts: 0,
        nextAttemptAllowedAt: 0,
        error: null,
        lockReason: null,
      });
      if (!opts?.viaBiometric) {
        useUiStore.getState().patchSettings({ lastPasswordUnlockAt: Date.now() });
      }
      return true;
    } catch (e) {
      set({
        lockPhase: 'locked',
        error: e instanceof Error ? e.message : 'Unlock failed.',
      });
      return false;
    }
  },

  /**
   * Unlock using Windows Hello / PIN: Rust verifies user consent and unseals
   * the DPAPI-protected master password, then we run the normal deriveKey +
   * checkVerifier flow. Cancelling Windows Hello does not count as a failed attempt.
   */
  unlockWithBiometric: async () => {
    const state = get();
    if (!state.uid) {
      set({ error: 'No signed-in user.' });
      return false;
    }
    if (Date.now() < state.nextAttemptAllowedAt) {
      const wait = Math.ceil((state.nextAttemptAllowedAt - Date.now()) / 1000);
      set({ error: `Too many attempts. Wait ${wait}s and try again.` });
      return false;
    }

    set({ lockPhase: 'unlocking', error: null });
    let password: string;
    try {
      password = await bridge.unlockWithBiometric(state.uid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'BIOMETRIC_CANCELLED') {
        set({ lockPhase: 'locked', error: null });
      } else {
        set({ lockPhase: 'locked', error: msg });
      }
      return false;
    }

    const ok = await get().unlock(password, { viaBiometric: true });
    if (!ok && get().error === 'Incorrect master password.') {
      // Master password was changed on the web app; wipe stale sealed key.
      void bridge.clearBiometric(state.uid).catch(() => undefined);
      useUiStore.getState().patchSettings({ helloEnabled: false });
      set({
        error: 'Your master password appears to have changed. Please unlock with your new password.',
      });
    }
    return ok;
  },

  /**
   * Lock: drop the key and all metadata. The store holds no decrypted
   * values, so nulling the key IS the wipe; dataStore holds ciphertext only.
   * The quick-search popup is told via a `vault:locked` event (sent by the
   * caller with the Tauri emitter) to clear its results.
   */
  lock: (opts) => {
    set({
      derivedKey: null,
      vaultMeta: get().vaultMeta ?? null,
      lockPhase: 'locked',
      error: null,
      lockReason: opts?.silent ? null : opts?.reason ?? null,
    });
  },

  /** Sign-out: forget uid and everything vault-related. */
  clearSession: () => {
    set({
      uid: null,
      derivedKey: null,
      vaultMeta: null,
      lockPhase: 'locked',
      lockReason: null,
      failedAttempts: 0,
      nextAttemptAllowedAt: 0,
      error: null,
    });
  },

  isVaultReady: () => get().derivedKey !== null,
}));

/**
 * Decrypt-or-throw helper used by every on-demand reveal/copy path.
 * Redis-solving "decrypt only with an unlocked key" in one place.
 */
export function requireKey(): CryptoKey {
  const key = useVaultStore.getState().derivedKey;
  if (!key) throw new Error('Vault is locked');
  return key;
}
