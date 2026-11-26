/**
 * SettingsView — non-secret preferences persisted to settings.json via Rust.
 *
 * Desktop-class layout: a sticky category rail on the left with scroll-spy,
 * and a wide content column on the right. Controls are purpose-built rather
 * than generic form rows — the hotkey renders as keycaps, timers use a
 * segmented preset control plus a stepper for fine tuning.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FiAlertTriangle, FiCheck, FiChevronRight, FiClipboard, FiCommand, FiExternalLink,
  FiGithub, FiGlobe, FiInfo, FiLock, FiLogOut, FiMinus, FiPlus, FiPower, FiRotateCcw, FiShield,
} from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { bridge, isTauri, openExternal } from '@/auth/bridge.js';
import { checkVerifier, deriveKey } from '@/backend/index.js';
import { BrandMark, Kbd, MOD_KEY } from '@/ui/components/primitives.js';
import { pushToast } from '@/ui/components/Toast.js';
import { lockNow } from '@/lib/autoLock.js';
import { DEFAULT_SETTINGS_FALLBACK } from '@/lib/settings.js';
import { APP_VERSION } from '@/lib/version.js';

type SectionId = 'search' | 'locking' | 'clipboard' | 'privacy' | 'session' | 'about';

const CREATOR_URL = 'https://hariharen.space';

const SECTIONS: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
  { id: 'search', label: 'Quick search', icon: <FiCommand size={14} /> },
  { id: 'locking', label: 'Locking', icon: <FiLock size={14} /> },
  { id: 'clipboard', label: 'Clipboard', icon: <FiClipboard size={14} /> },
  { id: 'privacy', label: 'Privacy', icon: <FiShield size={14} /> },
  { id: 'session', label: 'Session', icon: <FiLogOut size={14} /> },
  { id: 'about', label: 'About', icon: <FiInfo size={14} /> },
];

// ─── Controls ───────────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={
        'relative w-[42px] h-[24px] rounded-full border transition-colors disabled:opacity-40 ' +
        (on ? 'bg-accent/25 border-accent-border' : 'bg-white/[0.05] border-border hover:border-border-strong')
      }
    >
      <span
        className={
          'absolute top-[3px] w-[16px] h-[16px] rounded-full transition-all ' +
          (on ? 'left-[22px] bg-accent shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'left-[3px] bg-white/35')
        }
      />
    </button>
  );
}

function Segmented<T extends number>({ value, options, onChange }: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-black/30 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={
            'px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors ' +
            (value === o.value ? 'bg-accent-dim text-accent-light shadow-sm' : 'text-muted hover:text-text')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, min, max, step = 1, suffix, onChange }: {
  value: number; min: number; max: number; step?: number; suffix: string; onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-black/30 overflow-hidden">
      <button
        className="grid place-items-center w-7 h-7 text-muted hover:text-text hover:bg-white/[0.05] transition-colors disabled:opacity-30"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        aria-label="Decrease"
      >
        <FiMinus size={12} />
      </button>
      <input
        className="w-11 bg-transparent text-center font-mono text-[12px] outline-none tabular-nums"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
        aria-label={suffix}
      />
      <span className="mono-label pr-1 text-subtle">{suffix}</span>
      <button
        className="grid place-items-center w-7 h-7 text-muted hover:text-text hover:bg-white/[0.05] transition-colors disabled:opacity-30"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        aria-label="Increase"
      >
        <FiPlus size={12} />
      </button>
    </div>
  );
}

const TIME_PRESETS = [
  { label: 'Off', value: 0 },
  { label: '1m', value: 1 },
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
];
const CLIP_PRESETS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10 },
  { label: '20s', value: 20 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
];
const PASSWORD_DAY_PRESETS = [
  { label: 'Never', value: 0 },
  { label: '7d', value: 7 },
  { label: '14d', value: 14 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

// ─── Layout bits ────────────────────────────────────────────────────────────

function Section({ id, title, description, icon, children, danger }: {
  id: SectionId;
  title: string;
  description: string;
  icon: ReactNode;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-6 mb-6">
      <div className="flex items-start gap-2.5 mb-3">
        <span
          className={
            'grid place-items-center w-7 h-7 rounded-lg border shrink-0 ' +
            (danger ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-accent-border bg-accent-dim text-accent-light')
          }
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[14px] font-bold tracking-tight leading-tight">{title}</h2>
          <p className="text-[11.5px] text-muted mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
      <div className="card px-4 md:px-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, stacked }: {
  label: string;
  hint?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={
        'py-3.5 border-b border-border last:border-0 ' +
        (stacked ? 'flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between md:gap-6' : 'flex items-center justify-between gap-6')
      }
    >
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium">{label}</div>
        {hint && <div className="text-[11px] text-muted mt-0.5 leading-snug max-w-md">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Render an accelerator ("CommandOrControl+Shift+Backslash") as keycaps. */
function HotkeyCaps({ accel }: { accel: string }) {
  const tokens = useMemo(() => accel.split('+').map((t) => {
    if (t === 'CommandOrControl' || t === 'CmdOrCtrl') return MOD_KEY;
    if (t === 'Command' || t === 'Super' || t === 'Meta') return MOD_KEY;
    if (t === 'Control') return 'Ctrl';
    // Friendly glyphs for keys whose accelerator token is verbose.
    if (t === 'Backslash') return '\\';
    if (t === 'Backquote') return '`';
    if (t === 'Space') return 'Space';
    return t;
  }), [accel]);
  return (
    <span className="inline-flex items-center gap-1">
      {tokens.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[9px] text-subtle">+</span>}
          <Kbd>{t}</Kbd>
        </span>
      ))}
    </span>
  );
}

// ─── View ───────────────────────────────────────────────────────────────────

export default function SettingsView() {
  const settings = useUiStore((s) => s.settings);
  const patchSettings = useUiStore((s) => s.patchSettings);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const [autostart, setAutostart] = useState(false);
  const [helloAvailable, setHelloAvailable] = useState(false);
  const [enrollingHello, setEnrollingHello] = useState(false);
  const [enrollPassword, setEnrollPassword] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>('search');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri) return;
    void bridge.isAutostartEnabled().then(setAutostart).catch(() => undefined);
    void bridge.isBiometricAvailable().then(setHelloAvailable).catch(() => undefined);
  }, []);

  // Scroll-spy: highlight the rail item for the section nearest the top.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.id.replace('settings-', '') as SectionId;
          setActive(id);
        }
      },
      { root, rootMargin: '0px 0px -65% 0px', threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`settings-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const jumpTo = (id: SectionId) => {
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  // Hotkey capture: press the combo, register it, persist only on success.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(false); return; }

      const mods: string[] = [];
      if (e.ctrlKey) mods.push('Control');
      if (e.metaKey) mods.push('Super');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');

      // Only a modifier pressed so far — keep listening.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      if (mods.length === 0) return; // a global hotkey needs at least one modifier

      // Use the PHYSICAL key code, not e.key: Shift+`\` reports "|", Shift+/ "/"
      // reports "?", and the accelerator parser only understands key names.
      const main = e.code && e.code !== 'Unidentified' ? e.code : e.key;
      const accel = [...mods, main].join('+');

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

  // Restore the shipped default, re-registering it with the OS.
  const resetHotkey = () => {
    setHotkeyError(null);
    void bridge.registerHotkey(DEFAULT_SETTINGS_FALLBACK.hotkey)
      .then((ok) => {
        if (ok) {
          patchSettings({ hotkey: DEFAULT_SETTINGS_FALLBACK.hotkey });
          pushToast.success('Hotkey reset', DEFAULT_SETTINGS_FALLBACK.hotkey);
        } else {
          setHotkeyError('Could not register the default shortcut — it may be taken by another app.');
        }
      })
      .catch((err) => setHotkeyError(err instanceof Error ? err.message : String(err)));
  };

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

  const idle = settings.idleLockMinutes ?? 0;
  const hidden = settings.hiddenLockMinutes ?? 0;
  const passwordEveryDays = settings.requirePasswordEveryDays ?? 0;

  const confirmHelloEnrollment = async () => {
    const { uid, vaultMeta } = useVaultStore.getState();
    if (!uid || !vaultMeta || !enrollPassword || enrollBusy) return;
    setEnrollBusy(true);
    setEnrollError(null);
    try {
      const key = await deriveKey(enrollPassword, uid, vaultMeta.salt);
      const ok = await checkVerifier(key, vaultMeta.verifier);
      if (!ok) {
        setEnrollError('Incorrect master password.');
        return;
      }
      await bridge.enrollBiometric(uid, enrollPassword);
      patchSettings({ helloEnabled: true, lastPasswordUnlockAt: Date.now() });
      setEnrollingHello(false);
      setEnrollPassword('');
      pushToast.success('Windows Hello enabled', 'You can now unlock with Windows Hello or PIN');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEnrollError(msg === 'BIOMETRIC_CANCELLED' ? 'Windows Hello verification was cancelled.' : msg);
    } finally {
      setEnrollBusy(false);
    }
  };

  const toggleHello = (enable: boolean) => {
    const uid = useVaultStore.getState().uid;
    if (!enable) {
      patchSettings({ helloEnabled: false });
      if (uid) void bridge.clearBiometric(uid).catch(() => undefined);
      setEnrollingHello(false);
      setEnrollPassword('');
      setEnrollError(null);
      pushToast.success('Windows Hello disabled', 'Sealed key removed from this device');
      return;
    }
    setEnrollError(null);
    setEnrollPassword('');
    setEnrollingHello(true);
  };

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-6">
        {/* Header */}
        <div className="mb-6">
          <div className="mono-label flex items-center gap-1.5 mb-1.5">
            <span className="text-accent/70">//</span> preferences
          </div>
          <h1 className="font-display text-[20px] font-bold tracking-tight">Settings</h1>
          <p className="text-[12.5px] text-muted mt-1">
            Local, non-secret preferences. Your vault stays encrypted in Firestore.
          </p>
        </div>

        <div className="grid gap-6 md:gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
          {/* Category rail */}
          <nav className="hidden md:block">
            <div className="sticky top-0 space-y-0.5">
              <div className="mono-label px-2.5 mb-2">On this page</div>
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => jumpTo(s.id)}
                  className={
                    'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-left transition-colors ' +
                    (active === s.id
                      ? 'bg-accent-dim text-accent-light border border-accent-border'
                      : 'text-muted hover:text-text hover:bg-white/[0.04] border border-transparent')
                  }
                >
                  {s.icon}
                  <span className="flex-1">{s.label}</span>
                  {active === s.id && <FiChevronRight size={12} />}
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <div className="min-w-0">
            <Section id="search" title="Quick search" description="Summon the popup from anywhere on your desktop." icon={<FiCommand size={14} />}>
              <Row
                stacked
                label="Global hotkey"
                hint={isTauri ? 'Opens quick search from any app. Click change, then press a combination; Esc cancels.' : 'Only available inside the desktop shell.'}
              >
                <div className="flex items-center gap-2">
                  <div className={'rounded-lg border px-2.5 py-1.5 ' + (capturing ? 'border-accent-border bg-accent-dim' : 'border-border bg-black/30')}>
                    {capturing ? <span className="text-[11.5px] text-accent-light">Press keys…</span> : <HotkeyCaps accel={settings.hotkey} />}
                  </div>
                  <button
                    className="btn-ghost !py-1.5 !px-3 !text-[12px]"
                    onClick={() => { setHotkeyError(null); setCapturing(true); }}
                    disabled={!isTauri || capturing}
                  >
                    {capturing ? 'Listening…' : 'Change'}
                  </button>
                  <button
                    className="btn-ghost !py-1.5 !px-2.5 !text-[12px]"
                    onClick={resetHotkey}
                    disabled={!isTauri || capturing || settings.hotkey === DEFAULT_SETTINGS_FALLBACK.hotkey}
                    title="Restore the default shortcut"
                  >
                    <FiRotateCcw size={13} />
                  </button>
                </div>
              </Row>
              <Row label="Launch at login" hint={isTauri ? 'Start Scync in the tray when you sign in.' : 'Only available inside the desktop shell.'}>
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
            </Section>

            <Section id="locking" title="Locking" description="When the vault should re-lock and drop the key from memory." icon={<FiLock size={14} />}>
              <Row stacked label="Idle lock" hint="Lock after this long without keyboard or mouse activity.">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={idle} options={TIME_PRESETS} onChange={(v) => patchSettings({ idleLockMinutes: v })} />
                  {!TIME_PRESETS.some((p) => p.value === idle) && (
                    <Stepper value={idle} min={0} max={240} suffix="min" onChange={(v) => patchSettings({ idleLockMinutes: v })} />
                  )}
                </div>
              </Row>
              <Row stacked label="Lock when hidden" hint="Lock when the main window has been hidden to the tray for this long.">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={hidden} options={TIME_PRESETS} onChange={(v) => patchSettings({ hiddenLockMinutes: v })} />
                  {!TIME_PRESETS.some((p) => p.value === hidden) && (
                    <Stepper value={hidden} min={0} max={240} suffix="min" onChange={(v) => patchSettings({ hiddenLockMinutes: v })} />
                  )}
                </div>
              </Row>
              <Row
                stacked
                label="Windows Hello / PIN"
                hint={
                  !isTauri
                    ? 'Only available inside the desktop shell.'
                    : !helloAvailable
                      ? 'Windows Hello or PIN is not configured on this device.'
                      : 'Unlock the vault with Windows Hello (Face, Fingerprint, or PIN) instead of typing your master password every time.'
                }
              >
                <div className="flex items-center gap-2.5">
                  <span className={'mono-label ' + (settings.helloEnabled ? 'text-accent-light' : '')}>
                    {settings.helloEnabled ? 'On' : 'Off'}
                  </span>
                  <Toggle
                    on={settings.helloEnabled}
                    disabled={!isTauri || (!helloAvailable && !settings.helloEnabled)}
                    onChange={toggleHello}
                  />
                </div>
              </Row>
              {enrollingHello && (
                <div className="py-3.5 border-b border-border">
                  <div className="text-[12px] font-medium mb-1">Confirm your master password</div>
                  <p className="text-[11px] text-muted mb-2.5">
                    Your password is sealed locally with Windows DPAPI and gated by Windows Hello. It never leaves this device.
                  </p>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => { e.preventDefault(); void confirmHelloEnrollment(); }}
                  >
                    <input
                      type="password"
                      autoFocus
                      className={'field flex-1 min-w-[200px] ' + (enrollError ? 'field-error' : '')}
                      placeholder="Master password"
                      value={enrollPassword}
                      disabled={enrollBusy}
                      onChange={(e) => { setEnrollPassword(e.target.value); if (enrollError) setEnrollError(null); }}
                    />
                    <button type="submit" className="btn-primary !py-2 !px-3.5 !text-[12px]" disabled={enrollBusy || !enrollPassword}>
                      {enrollBusy ? <><span className="spinner" /> Verifying…</> : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !py-2 !px-3 !text-[12px]"
                      disabled={enrollBusy}
                      onClick={() => { setEnrollingHello(false); setEnrollPassword(''); setEnrollError(null); }}
                    >
                      Cancel
                    </button>
                  </form>
                  {enrollError && (
                    <div className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-2" role="alert">
                      <FiAlertTriangle size={12} /> {enrollError}
                    </div>
                  )}
                </div>
              )}
              {settings.helloEnabled && (
                <Row
                  stacked
                  label="Require master password"
                  hint="Periodically verify your master password even when Windows Hello is enabled. Default: 14 days."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      value={passwordEveryDays}
                      options={PASSWORD_DAY_PRESETS}
                      onChange={(v) => patchSettings({ requirePasswordEveryDays: v === 0 ? null : v })}
                    />
                    {!PASSWORD_DAY_PRESETS.some((p) => p.value === passwordEveryDays) && (
                      <Stepper
                        value={passwordEveryDays}
                        min={1}
                        max={365}
                        suffix="days"
                        onChange={(v) => patchSettings({ requirePasswordEveryDays: v })}
                      />
                    )}
                  </div>
                </Row>
              )}
            </Section>

            <Section id="clipboard" title="Clipboard" description="Copied values are wiped automatically after a delay." icon={<FiClipboard size={14} />}>
              <Row
                stacked
                label="Auto-clear after copy"
                hint="The clipboard is cleared only if it still holds the value we copied. 0 disables."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented value={settings.clipboardClearSecs} options={CLIP_PRESETS} onChange={(v) => patchSettings({ clipboardClearSecs: v })} />
                  {!CLIP_PRESETS.some((p) => p.value === settings.clipboardClearSecs) && (
                    <Stepper value={settings.clipboardClearSecs} min={0} max={300} suffix="sec" onChange={(v) => patchSettings({ clipboardClearSecs: v })} />
                  )}
                </div>
              </Row>
            </Section>

            <Section id="privacy" title="Privacy" description="Reduce what can leak from this window." icon={<FiShield size={14} />}>
              <Row stacked label="Content protection" hint="Excludes the window from screen capture and recordings (Windows: WDA_EXCLUDEFROMCAPTURE). Applied live.">
                <div className="flex items-center gap-2.5">
                  <span className={'mono-label ' + (settings.contentProtection ? 'text-accent-light' : '')}>
                    {settings.contentProtection ? 'On' : 'Off'}
                  </span>
                  <Toggle on={settings.contentProtection} onChange={(v) => patchSettings({ contentProtection: v })} />
                </div>
              </Row>
            </Section>

            {hotkeyError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-300">
                <FiAlertTriangle size={13} className="mt-0.5 shrink-0" /> {hotkeyError}
              </div>
            )}

            <Section id="session" title="Session" description="Lock the vault or end this session." icon={<FiLogOut size={14} />} danger>
              <Row label="Lock vault" hint="Drops the derived key immediately. Unlocking needs only your master password.">
                <button
                  className="btn-ghost"
                  onClick={() => { lockNow('manual'); pushToast.success('Vault locked', 'Key discarded from memory'); }}
                >
                  <FiCheck size={13} /> Lock now
                </button>
              </Row>
              <Row label="Sign out" hint="Ends the Firebase session and locks the vault. You will need to sign in again.">
                <button className="btn-ghost hover:!text-rose-300 hover:!border-rose-500/40" onClick={signOutFlow}>
                  <FiLogOut size={13} /> Sign out
                </button>
              </Row>
            </Section>

            <Section id="about" title="About" description="Version, provenance, and source." icon={<FiInfo size={14} />}>
              <div className="flex items-center gap-3 py-3.5 border-b border-border">
                <BrandMark size={30} glow />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold">Scync Desktop</div>
                  <div className="mono-label mt-0.5">v{APP_VERSION} · MIT · zero-knowledge</div>
                </div>
                <button className="btn-ghost !px-3 !py-1.5 !text-[12px]" onClick={() => useUiStore.getState().setAboutOpen(true)}>
                  Details
                </button>
              </div>

              <Row label="Designed & built by" hint="Scync Desktop is crafted by Hariharen — visit the portfolio to see more work.">
                <button className="btn-ghost !py-1.5 !px-3 !text-[12px]" onClick={() => openExternal(CREATOR_URL)}>
                  <FiGlobe size={13} /> Hariharen <FiExternalLink size={11} />
                </button>
              </Row>
              <Row label="Source code" hint="Open-source and MIT licensed — read the code that guards your vault.">
                <button className="btn-ghost !py-1.5 !px-3 !text-[12px]" onClick={() => openExternal('https://github.com/hariharen9/Scync-Desktop')}>
                  <FiGithub size={13} /> GitHub <FiExternalLink size={11} />
                </button>
              </Row>
              <Row label="Documentation" hint="Interop guarantees, threat model, and decisions.">
                <button className="btn-ghost !py-1.5 !px-3 !text-[12px]" onClick={() => openExternal('https://scync.space')}>
                  scync.space <FiExternalLink size={11} />
                </button>
              </Row>
            </Section>

            <div className="rounded-xl border border-accent-border bg-accent-dim/40 px-4 py-3 mb-4 flex items-center gap-3">
              <span className="grid place-items-center w-9 h-9 rounded-full bg-accent/20 border border-accent-border text-accent-light font-display font-extrabold text-[14px] shrink-0">
                H
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-mono uppercase tracking-[0.09em] text-subtle">Designed &amp; built by</div>
                <button
                  className="text-[13.5px] font-semibold text-text hover:text-accent-light transition-colors inline-flex items-center gap-1.5"
                  onClick={() => openExternal(CREATOR_URL)}
                >
                  Hariharen <FiExternalLink size={11} className="text-subtle" />
                </button>
              </div>
              <button
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-accent-border bg-black/20 px-2.5 py-1.5 text-[11.5px] text-accent-light hover:bg-accent-dim transition-colors"
                onClick={() => openExternal(CREATOR_URL)}
              >
                <FiGlobe size={11} /> hariharen.space
              </button>
            </div>

            <p className="mono-label flex items-center gap-2 pt-1 pb-2">
              <FiPower size={10} /> Scync {APP_VERSION} · no telemetry · no server-side keys
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
