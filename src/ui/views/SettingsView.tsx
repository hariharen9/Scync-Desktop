/**
 * SettingsView — non-secret settings persisted to settings.json via Rust.
 * Hotkey capture, auto-lock timers, clipboard behaviour, optional launch
 * at login, content protection.
 */
import { useEffect, useState } from 'react';
import { FiSquare } from 'react-icons/fi';
import { useUiStore, useUiStore as useStore } from '@/stores/uiStore.js';
import { bridge } from '@/auth/bridge.js';
import { ViewHeader } from '@/ui/components/common.js';
import { pushToast } from '@/ui/components/Toast.js';
import { isTauri } from '@/auth/bridge.js';

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5 border-b border-border">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11px] text-muted mt-0.5">{hint}</div>
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
      className={'w-10 h-6 rounded-full border transition-colors relative ' + (on ? 'bg-accent-dim border-accent-border' : 'bg-white/5 border-border')}
    >
      <span className={'absolute top-0.5 w-4.5 h-4.5 rounded-full transition-all ' + (on ? 'left-[18px] bg-accent' : 'left-0.5 bg-placeholder bg-white/30')} style={{ width: 18, height: 18 }} />
    </button>
  );
}

export default function SettingsView() {
  const settings = useUiStore((s) => s.settings);
  const patchSettings = useUiStore((s) => s.patchSettings);
  const [autostart, setAutostart] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const setAboutOpen = useStore((s) => s.setAboutOpen);

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
        const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
        parts.push(key);
      }
      if (parts.length < 2) return; // need at least a modifier
      const accel = parts.join('+');
      setCapturing(false);
      void bridge.registerHotkey(accel)
        .then((ok) => {
          if (ok) {
            patchSettings({ hotkey: accel });
            setHotkeyError(null);
            pushToast('Hotkey registered', accel);
          } else {
            setHotkeyError(`"${accel}" is taken by another app — pick a different combo.`);
          }
        })
        .catch((err) => setHotkeyError(err instanceof Error ? err.message : String(err)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, patchSettings]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <ViewHeader title="Settings" subtitle="Local, non-secret preferences. Vault data stays in Firestore/encrypted." />
      <div className="max-w-xl">
        <div className="card px-4 py-1 mb-4">
          <Row title="Quick-search hotkey" hint={isTauri ? 'Global shortcut to open the quick popup (click to re-record).' : 'Only available inside the desktop shell.'}>
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
                  .then(() => setAutostart(v))
                  .catch((e) => pushToast('Autostart failed', e instanceof Error ? e.message : String(e)));
              }}
            />
          </Row>
        </div>

        <div className="card px-4 py-1 mb-4">
          <Row title="Idle lock" hint="Lock the vault after this many minutes of no keyboard or mouse activity. Set 0 to disable.">
            <input
              className="field !w-24 text-right"
              type="number"
              min={0}
              max={240}
              value={settings.idleLockMinutes ?? 0}
              onChange={(e) => patchSettings({ idleLockMinutes: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Row>
          <Row title="Lock when hidden" hint="Lock when the main window is hidden to the tray for this many minutes. Set 0 to disable.">
            <input
              className="field !w-24 text-right"
              type="number"
              min={0}
              max={240}
              value={settings.hiddenLockMinutes ?? 0}
              onChange={(e) => patchSettings({ hiddenLockMinutes: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Row>
          <Row title="Clipboard auto-clear" hint="Copied secrets and codes are cleared from the clipboard after this many seconds (only if the clipboard still holds the copied value).">
            <input
              className="field !w-24 text-right"
              type="number"
              min={0}
              max={300}
              value={settings.clipboardClearSecs}
              onChange={(e) => patchSettings({ clipboardClearSecs: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Row>
        </div>

        <div className="card px-4 py-1 mb-4">
          <Row title="Content protection" hint="Prevents screen capture and appearing in screen recordings (Windows: WDA_EXCLUDEFROMCAPTURE). Applied live.">
            <Toggle on={settings.contentProtection} onChange={(v) => patchSettings({ contentProtection: v })} />
          </Row>
        </div>

        {hotkeyError && <div className="text-[12px] text-rose-400 mt-2">{hotkeyError}</div>}

        <div className="card px-4 py-1">
          <Row title="About Scync" hint="Version, crypto stack, and provenance notes.">
            <button className="btn-ghost" onClick={() => setAboutOpen(true)}><FiSquare size={12} className="mr-1.5 inline" />Open</button>
          </Row>
        </div>
      </div>
    </div>
  );
}
