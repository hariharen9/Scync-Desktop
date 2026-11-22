/**
 * SettingsView — non-secret settings persisted to settings.json via Rust.
 * Hotkey capture, auto-lock timers, clipboard behaviour, launch at login,
 * content protection. Grouped so the screen reads like a control panel.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FiAlertTriangle, FiCheck, FiExternalLink, FiLogOut, FiPower } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { bridge, isTauri, openExternal } from '@/auth/bridge.js';
import { PageHeader } from '@/ui/components/common.js';
import { SectionLabel } from '@/ui/components/primitives.js';
import { pushToast } from '@/ui/components/Toast.js';
import { lockNow } from '@/lib/autoLock.js';
import { APP_VERSION } from '@/lib/version.js';

function Row({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11px] text-muted mt-0.5 leading-snug max-w-md">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={'w-10 h-[22px] rounded-full border transition-colors relative disabled:opacity-50 ' + (on ? 'bg-accent-dim border-accent-border' : 'bg-white/[0.05] border-border')}
    >
      <span className={'absolute top-[2px] w-[16px] h-[16px] rounded-full transition-all ' + (on ? 'left-[21px] bg-accent' : 'left-[2px] bg-white/35')} />
    </button>
  );
}

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5">
      <SectionLabel trailing={action}>{title}</SectionLabel>
      <div className="card px-4">{children}</div>
    </div>
  );
}

export default function SettingsView() {
  const settings = useUiStore((s) => s.settings);
  const patchSettings = useUiStore((s) => s.patchSettings);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const [autostart, setAutostart] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) void bridge.isAutostartEnabled().then(setAutostart).catch(() => undefined);
  }, []);

  // Hotkey capture: press the combo, register it, persist only on success.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.metaKey) parts.push('Super');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      }
      if (parts.length < 2) return; // need at least one modifier + a key
      const accel = parts.join('+');
      setCapturing(false);
      void bridge.registerHotkey(accel)
        .then((ok) => {
          if (ok) {
            patchSettings({ hotkey: accel });
            setHotkeyError(null);
            pushToast.success('Hotkey registered', accel);
          } else {
            setHotkeyError(`"${accel}" is taken by another app — pick a different combo.`);
          }
        })
        .catch((err) => setHotkeyError(err instanceof Error ? err.message : String(err)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, patchSettings]);

  const signOutFlow = () => askConfirm({
    title: 'Lock and sign out?',
    message: 'The vault key is discarded and your Firebase session ends. You will need to sign in again.',
    confirmText: 'Sign out',
    danger: false,
    onConfirm: () => {
      lockNow('sign-out');
      void import('@/auth/session.js').then((m) => m.signOut());
    },
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-6">
        <PageHeader title="Settings" subtitle="Local, non-secret preferences. Vault data stays encrypted in Firestore." />

        <Card title="Quick search">
          <Row title="Global hotkey" hint={isTauri ? 'Opens the quick popup from anywhere. Click to re-record; Esc cancels.' : 'Only available inside the desktop shell.'}>
            <button
              className={'btn-ghost font-mono text-[12px] min-w-[190px] ' + (capturing ? 'border-accent-border text-accent-light' : '')}
              onClick={() => { setHotkeyError(null); setCapturing(true); }}
              disabled={!isTauri}
            >
              {capturing ? 'Press keys… (Esc cancels)' : settings.hotkey}
            </button>
          </Row>
          <Row title="Launch at login" hint={isTauri ? 'Start Scync in the tray when you log in.' : 'Only available inside the desktop shell.'}>
            <Toggle
              on={autostart}
              disabled={!isTauri}
              onChange={(v) => {
                if (!isTauri) return;
                void bridge.toggleAutostart(v)
                  .then(() => { setAutostart(v); pushToast.success(v ? 'Launch at login enabled' : 'Launch at login disabled'); })
                  .catch((e) => pushToast.error('Autostart failed', e instanceof Error ? e.message : String(e)));
              }}
            />
          </Row>
        </Card>

        <Card title="Locking">
          <Row title="Idle lock" hint="Lock the vault after this many minutes without keyboard or mouse activity. 0 disables.">
            <NumberField value={settings.idleLockMinutes ?? 0} min={0} max={240} suffix="min" onChange={(v) => patchSettings({ idleLockMinutes: v })} />
          </Row>
          <Row title="Lock when hidden" hint="Lock when the main window has been hidden to the tray for this many minutes. 0 disables.">
            <NumberField value={settings.hiddenLockMinutes ?? 0} min={0} max={240} suffix="min" onChange={(v) => patchSettings({ hiddenLockMinutes: v })} />
          </Row>
        </Card>

        <Card title="Clipboard">
          <Row title="Auto-clear" hint="Copied secrets and codes are cleared from the clipboard after this many seconds (only if the clipboard still holds the copied value). 0 disables.">
            <NumberField value={settings.clipboardClearSecs} min={0} max={300} suffix="sec" onChange={(v) => patchSettings({ clipboardClearSecs: v })} />
          </Row>
        </Card>

        <Card title="Privacy">
          <Row title="Content protection" hint="Prevents screen capture and appearing in screen recordings (Windows: WDA_EXCLUDEFROMCAPTURE). Applied live.">
            <Toggle on={settings.contentProtection} onChange={(v) => patchSettings({ contentProtection: v })} />
          </Row>
        </Card>

        {hotkeyError && (
          <div className="flex items-start gap-2 text-[12px] text-rose-400 -mt-2 mb-4">
            <FiAlertTriangle size={13} className="mt-0.5 shrink-0" /> {hotkeyError}
          </div>
        )}

        <Card title="Session">
          <Row title="Lock vault" hint="Discard the derived key immediately. The auth session survives; unlock needs only your master password.">
            <button className="btn-ghost" onClick={() => { lockNow('manual'); }}>
              <FiCheck size={13} /> Lock now
            </button>
          </Row>
          <Row title="Sign out" hint="End the Firebase session and lock the vault.">
            <button className="btn-ghost hover:!text-rose-300 hover:!border-rose-500/40" onClick={signOutFlow}>
              <FiLogOut size={13} /> Sign out
            </button>
          </Row>
        </Card>

        <Card title="About">
          <Row title="Scync Desktop" hint="Version, crypto stack, and provenance notes.">
            <div className="flex items-center gap-2">
              <span className="chip">v{APP_VERSION}</span>
              <button className="btn-ghost !px-2.5" onClick={() => useUiStore.getState().setAboutOpen(true)}>Open</button>
            </div>
          </Row>
          <Row title="Source" hint="Open-source, MIT licensed — read the code that guards your vault.">
            <button className="btn-ghost" onClick={() => openExternal('https://github.com/hariharen9/Scync-Desktop')}>
              <FiExternalLink size={13} /> GitHub
            </button>
          </Row>
        </Card>

        <p className="mono-label text-center flex items-center justify-center gap-2 pb-2">
          <FiPower size={10} /> Scync {APP_VERSION} · zero-knowledge · no telemetry
        </p>
      </div>
    </div>
  );
}

function NumberField({ value, min, max, suffix, onChange }: {
  value: number; min: number; max: number; suffix: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="field !w-20 text-right font-mono"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      />
      <span className="mono-label w-7">{suffix}</span>
    </div>
  );
}
