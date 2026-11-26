/**
 * Unlock screen — the product's signature moment.
 *
 * The constellation on the right lights node-by-node as the master password
 * grows (a nod to the web app's vault-identity visual), runs a ring while
 * PBKDF2 is deriving, and settles to a green sealed state on success. The
 * left panel is the actual unlock: auto-focused field, inline caps-lock hint,
 * attempt pips, client-side backoff, and honest zero-knowledge copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertTriangle, FiArrowRight, FiCheck, FiEye, FiEyeOff, FiKey, FiLogOut, FiLock, FiShield } from 'react-icons/fi';
import { useVaultStore, retryDelayMs, MAX_ATTEMPTS_BEFORE_DELAY } from '@/stores/vaultStore.js';
import { useUiStore } from '@/stores/uiStore.js';
import { bridge, isTauri } from '@/auth/bridge.js';
import { isPasswordRequiredNow } from '@/lib/settings.js';
import { BrandMark, Wordmark, Avatar } from '@/ui/components/primitives.js';

const OUTER = 12;
const INNER = 6;
const OUTER_R = 118;
const INNER_R = 70;
const C = 130;

const polar = (i: number, count: number, radius: number): [number, number] => {
  const a = -Math.PI / 2 + (i / count) * Math.PI * 2;
  return [C + Math.cos(a) * radius, C + Math.sin(a) * radius];
};

const NODES: [number, number][] = [
  ...Array.from({ length: OUTER }, (_, i) => polar(i, OUTER, OUTER_R)),
  ...Array.from({ length: INNER }, (_, i) => polar(i, INNER, INNER_R)),
];

const EDGES: Array<{ i: number; j: number; kind: 'ring' | 'spoke' }> = (() => {
  const e: Array<{ i: number; j: number; kind: 'ring' | 'spoke' }> = [];
  for (let i = 0; i < OUTER; i++) e.push({ i, j: (i + 1) % OUTER, kind: 'ring' });
  for (let i = 0; i < INNER; i++) e.push({ i: OUTER + i, j: OUTER + ((i + 1) % INNER), kind: 'ring' });
  for (let i = 0; i < INNER; i++) e.push({ i: OUTER + i, j: (i * 2) % OUTER, kind: 'spoke' });
  return e;
})();

const nodesForLength = (len: number) => Math.min(Math.round((len / 16) * NODES.length), NODES.length);

export default function UnlockScreen({
  email,
  displayName,
  photoURL,
  unlocking,
  onSignOut,
}: {
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
  unlocking: boolean;
  onSignOut?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const failedAttempts = useVaultStore((s) => s.failedAttempts);
  const nextAttemptAllowedAt = useVaultStore((s) => s.nextAttemptAllowedAt);
  const error = useVaultStore((s) => s.error);
  const lockReason = useVaultStore((s) => s.lockReason);
  const uid = useVaultStore((s) => s.uid);
  const unlock = useVaultStore((s) => s.unlock);
  const unlockWithBiometric = useVaultStore((s) => s.unlockWithBiometric);
  const justSucceeded = useVaultStore((s) => s.lockPhase === 'unlocked');
  const settings = useUiStore((s) => s.settings);
  const settingsLoaded = useUiStore((s) => s.settingsLoaded);
  const [helloReady, setHelloReady] = useState(false);
  const autoPromptedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const passwordRequired = isPasswordRequiredNow(settings);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri || !settingsLoaded || !settings.helloEnabled || !uid) {
      setHelloReady(false);
      return;
    }
    void Promise.all([
      bridge.isBiometricAvailable().catch(() => false),
      bridge.hasBiometricEnrolled(uid).catch(() => false),
    ]).then(([avail, enrolled]) => {
      if (!cancelled) setHelloReady(avail && enrolled);
    });
    return () => { cancelled = true; };
  }, [settingsLoaded, settings.helloEnabled, uid]);

  // Auto-prompt Windows Hello once per lock cycle when enabled and within the password-free window.
  useEffect(() => {
    if (!helloReady || passwordRequired || unlocking || justSucceeded || autoPromptedRef.current) return;
    if (Date.now() < nextAttemptAllowedAt) return;
    autoPromptedRef.current = true;
    void unlockWithBiometric();
  }, [helloReady, passwordRequired, unlocking, justSucceeded, nextAttemptAllowedAt, unlockWithBiometric]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // Keep focus on the password field: typing anywhere lands here (web-app trick).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const waitSecs = Math.max(0, Math.ceil((nextAttemptAllowedAt - nowMs) / 1000));
  const rateLimited = waitSecs > 0;
  const activeNodes = justSucceeded ? NODES.length : nodesForLength(password.length);
  const activeSet = useMemo(() => new Set(Array.from({ length: activeNodes }, (_, i) => i)), [activeNodes]);

  const submit = () => {
    if (!password || unlocking || rateLimited) return;
    void unlock(password).then((ok) => { if (!ok) setPassword(''); });
  };

  const capsHint = capsOn && !error;

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="min-h-full flex flex-col">
        {/* Topbar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <BrandMark size={26} />
            <Wordmark small />
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:flex items-center gap-2 mono-label">
              <span className={`w-1.5 h-1.5 rounded-full ${unlocking || justSucceeded ? 'bg-emerald-400' : 'bg-amber-400'} ${justSucceeded ? '' : 'animate-pulse'}`} />
              {justSucceeded ? 'Vault unlocked' : unlocking ? 'Decrypting…' : 'Session locked'}
            </span>
            <span className="hidden md:inline mono-label text-subtle">zero-knowledge</span>
          </div>
        </header>

        <div className="flex-1 grid lg:grid-cols-2 items-stretch">
          {/* ─── Unlock form ─── */}
          <section className="flex items-center justify-center p-6 md:p-10">
            <div className="w-full max-w-sm anim-fade-up">
              <div className="mono-label flex items-center gap-1.5 mb-2">
                <FiLock size={11} /> <span className="text-accent/70">//</span> vault access
              </div>
              <h1 className="font-display text-[22px] font-extrabold tracking-tight">
                {justSucceeded ? 'Vault unlocked.' : 'Unlock your vault.'}
              </h1>
              <p className="text-[12.5px] text-muted mt-2 leading-relaxed">
                {justSucceeded ? 'Opening your encrypted workspace…' : 'Enter your master password to derive the key on this device.'}
              </p>

              {lockReason && !justSucceeded && (
                <div className="mt-3 flex items-center gap-2 text-[11.5px] text-amber-300/90">
                  <FiLock size={11} className="shrink-0" />
                  <span>Locked automatically · {lockReason}</span>
                </div>
              )}

              {settings.helloEnabled && helloReady && passwordRequired && !justSucceeded && (
                <div className="mt-3 flex items-center gap-2 text-[11.5px] text-amber-300/90">
                  <FiShield size={11} className="shrink-0" />
                  <span>
                    Periodic check · master password required
                    {settings.requirePasswordEveryDays ? ` (every ${settings.requirePasswordEveryDays}d)` : ''}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 mt-6 mb-5">
                <Avatar name={displayName} email={email} photoURL={photoURL} size={26} />
                <span className="text-[12px] text-muted truncate" title={email}>{email}</span>
              </div>

              <label className="mono-label block mb-1.5" htmlFor="unlock-password">Master password</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none">
                  <FiKey size={13} />
                </span>
                <input
                  id="unlock-password"
                  ref={inputRef}
                  autoFocus
                  className={`field pl-9 pr-16 ${error ? 'field-error' : ''}`}
                  type={show ? 'text' : 'password'}
                  placeholder="Enter vault password"
                  value={password}
                  disabled={unlocking || rateLimited || justSucceeded}
                  autoComplete="current-password"
                  spellCheck={false}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    setCapsOn(e.getModifierState?.('CapsLock') ?? false);
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  }}
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text transition-colors p-1"
                  onClick={() => setShow((v) => !v)}
                  type="button"
                  tabIndex={-1}
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                </button>
              </div>

              {/* Attempt pips */}
              {failedAttempts > 0 && (
                <div className="flex items-center gap-1.5 mt-2.5">
                  <span className="mono-label mr-1">attempts</span>
                  {Array.from({ length: Math.max(MAX_ATTEMPTS_BEFORE_DELAY, failedAttempts) }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-4 h-1 rounded-full transition-colors ${i < failedAttempts ? 'bg-rose-500' : 'bg-border-strong'}`}
                    />
                  ))}
                </div>
              )}

              {error ? (
                <div className="flex items-start gap-1.5 text-[12px] text-rose-400 mt-3 anim-fade-in" role="alert">
                  <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{rateLimited ? `Too many attempts. Try again in ${waitSecs}s.` : error}</span>
                </div>
              ) : capsHint ? (
                <div className="flex items-center gap-1.5 text-[11.5px] text-amber-300 mt-3">
                  <FiAlertTriangle size={12} /> Caps Lock is on.
                </div>
              ) : (
                <div className="h-[18px] mt-3" />
              )}

              <button
                className="btn-primary w-full mt-1"
                disabled={unlocking || rateLimited || !password || justSucceeded}
                onClick={submit}
              >
                {justSucceeded ? (
                  <><FiCheck size={15} /> Vault unlocked</>
                ) : unlocking ? (
                  <><span className="spinner" /> Deriving key…</>
                ) : rateLimited ? (
                  <>Locked · {waitSecs}s</>
                ) : (
                  <>Unlock <FiArrowRight size={14} /></>
                )}
              </button>

              {helloReady && !passwordRequired && !justSucceeded && (
                <button
                  type="button"
                  className="btn-ghost w-full mt-2.5 !text-[12.5px]"
                  disabled={unlocking || rateLimited}
                  onClick={() => void unlockWithBiometric()}
                >
                  <FiShield size={14} className="text-accent-light" />
                  Unlock with Windows Hello / PIN
                </button>
              )}

              <div className="mt-4 h-0.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-500 ${password.length >= 12 ? 'bg-accent-light' : 'bg-accent'}`}
                  style={{ width: `${Math.min(password.length / 16, 1) * 100}%` }}
                />
              </div>

              <p className="mono-label text-center mt-3">
                {unlocking ? 'PBKDF2-SHA256 · 310,000 iterations' : 'key stays in memory · never leaves this device'}
              </p>

              {failedAttempts >= MAX_ATTEMPTS_BEFORE_DELAY && (
                <p className="text-[11px] text-subtle text-center mt-1">
                  Next attempt in {Math.ceil(retryDelayMs(failedAttempts) / 1000)}s (client-side backoff)
                </p>
              )}

              {onSignOut && (
                <button className="btn-ghost w-full mt-4 !text-[12px]" onClick={onSignOut} disabled={unlocking || justSucceeded}>
                  <FiLogOut size={13} /> Use a different account
                </button>
              )}
            </div>
          </section>

          {/* ─── Vault identity / constellation ─── */}
          <section className="relative hidden lg:flex items-center justify-center overflow-hidden border-l border-border grid-bg">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(circle at 50% 45%, rgba(16,185,129,0.10), transparent 62%)' }}
            />
            <div className="relative flex flex-col items-center px-8 py-6 w-full max-h-full overflow-y-auto">
              <div className="mono-label flex items-center gap-1.5 mb-1">
                <span className="text-accent/70">//</span> vault identity
              </div>
              <h2 className="font-display text-[23px] font-extrabold tracking-tight leading-[1.15] mb-1 text-center">
                Sealed <span className="text-accent-light">by design.</span>
              </h2>

              <div className="relative my-4 shrink-0" style={{ width: 216, height: 216 }}>
                {justSucceeded && (
                  <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.35), transparent 62%)', filter: 'blur(18px)' }}
                  />
                )}
                <svg viewBox="0 0 260 260" width={216} height={216} className="relative">
                  <circle cx={C} cy={C} r={OUTER_R} fill="none" stroke="rgba(255,255,255,0.06)" />
                  <circle cx={C} cy={C} r={INNER_R} fill="none" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 5" />
                  <circle cx={C} cy={C} r={48} fill="none" stroke="rgba(16,185,129,0.12)" />
                  {EDGES.map((e, i) => {
                    const on = activeSet.has(e.i) && activeSet.has(e.j);
                    return (
                      <line
                        key={i}
                        x1={NODES[e.i][0]} y1={NODES[e.i][1]}
                        x2={NODES[e.j][0]} y2={NODES[e.j][1]}
                        stroke={on ? (justSucceeded ? '#34d399' : '#10b981') : 'rgba(255,255,255,0.05)'}
                        strokeWidth={on ? 1.3 : 1}
                        style={{ transition: 'stroke 300ms ease, opacity 300ms ease', opacity: on ? 0.85 : 1 }}
                      />
                    );
                  })}
                  {NODES.map(([x, y], i) => {
                    const on = activeSet.has(i);
                    return (
                      <circle
                        key={i}
                        cx={x} cy={y} r={on ? 3.2 : 2.2}
                        fill={on ? (justSucceeded ? '#6ee7b7' : '#10b981') : 'rgba(255,255,255,0.14)'}
                        style={{ transition: `fill 280ms ease ${(i % OUTER) * 14}ms, r 280ms ease` }}
                      />
                    );
                  })}
                </svg>

                {/* Center seal */}
                <div className="absolute inset-0 grid place-items-center">
                  <div
                    className={`grid place-items-center rounded-full border transition-all duration-500 ${
                      justSucceeded ? 'w-16 h-16 border-emerald-400/70 bg-accent-dim' : 'w-14 h-14 border-accent-border bg-panel'
                    }`}
                    style={{ boxShadow: justSucceeded ? '0 0 30px rgba(16,185,129,0.4)' : undefined }}
                  >
                    {justSucceeded ? (
                      <FiCheck size={24} className="text-accent-light" />
                    ) : unlocking ? (
                      <span className="spinner spinner-lg" />
                    ) : (
                      <FiLock size={20} className="text-accent-light" />
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center text-center">
                <Avatar name={displayName} email={email} photoURL={photoURL} size={36} />
                <div className="text-[13px] font-semibold truncate max-w-[240px] mt-2">
                  {displayName || email.split('@')[0] || 'your vault'}
                </div>
                {displayName && email && (
                  <div className="text-[11px] text-subtle truncate max-w-[240px]">{email}</div>
                )}
                <div className="mono-label mt-1">{justSucceeded ? 'unsealed' : unlocking ? 'deriving key' : 'vault is locked'}</div>
              </div>

              <p className="text-[11.5px] text-muted text-center leading-relaxed max-w-[260px] mt-5">
                Your master password decrypts this vault locally. It is never sent, stored, or
                recoverable by Scync.
              </p>

              <div className="flex items-center gap-3 mt-5 mono-label">
                <span className="flex items-center gap-1.5"><FiShield size={10} /> AES-256-GCM</span>
                <span className="text-border-strong">/</span>
                <span>PBKDF2 · 310k</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
