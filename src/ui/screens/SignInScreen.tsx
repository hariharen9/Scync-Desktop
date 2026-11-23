/**
 * Sign-in gate: Google (loopback via Rust) + email/password, in the web app's
 * visual language. A split "front door" brief on the left explains the
 * identity-vs-key distinction; the form sits on the right. The footer states
 * honestly that the master password is separate and unrecoverable.
 */
import { useEffect, useRef, useState } from 'react';
import { FiAlertTriangle, FiArrowRight, FiLock, FiShield, FiZap } from 'react-icons/fi';
import { signInWithGoogle, signInWithEmail } from '@/auth/session.js';
import { isGoogleLoginEnabled } from '@/backend/firebase.js';
import { isTauri } from '@/auth/bridge.js';
import { BrandMark, Wordmark, Kbd } from '@/ui/components/primitives.js';

function authErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/invalid-login-credentials')) {
    return 'Incorrect email or password.';
  }
  if (msg.includes('auth/user-not-found')) return 'No account with that email.';
  if (msg.includes('auth/invalid-email')) return 'That email address is not valid.';
  if (msg.includes('auth/too-many-requests')) return 'Too many attempts — wait a moment and retry.';
  if (msg.includes('auth/network-request-failed')) return 'Network error — check your connection.';
  if (msg.includes('auth/user-disabled')) return 'This account has been disabled.';
  if (msg.startsWith('SCYNC_DEV')) return 'Not running inside the Scync desktop shell.';
  return msg;
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const FACTS = [
  { icon: <FiShield size={13} />, title: 'Local decryption', body: 'Your master password derives the key in this window only.' },
  { icon: <FiLock size={13} />, title: 'Zero-knowledge', body: 'No server ever sees your secrets or your key.' },
  { icon: <FiZap size={13} />, title: 'Global quick search', body: 'Hit your hotkey to copy any secret without leaving the keyboard.' },
];

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, []);

  const run = async (kind: 'google' | 'email') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'google') await signInWithGoogle();
      else await signInWithEmail(email, password);
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  // Esc clears the focused field (and any error), mirroring the unlock screen.
  const onEscape = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    if (e.currentTarget.id === 'si-email') setEmail('');
    else if (e.currentTarget.id === 'si-password') setPassword('');
    setError(null);
  };

  const googleEnabled = isGoogleLoginEnabled();

  return (
    <div className="h-full w-full overflow-y-auto grid-bg">
      <div className="min-h-full flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-4xl grid md:grid-cols-[1fr_400px] rounded-2xl border border-border bg-panel/80 backdrop-blur-sm overflow-hidden shadow-2xl anim-scale-in">
          {/* ─── Brand brief ─── */}
          <aside className="relative hidden md:flex flex-col justify-between p-9 overflow-hidden border-r border-border">
            <div className="absolute inset-0 grid-bg radial-fade opacity-70 pointer-events-none" />
            <div
              className="absolute -top-24 -left-16 w-72 h-72 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.16), transparent 70%)' }}
            />
            <div className="relative">
              <div className="mb-9">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={30} glow />
                  <Wordmark />
                </div>
                <div className="mono-label mt-1 pl-[42px]">desktop</div>
              </div>

              <div className="mono-label flex items-center gap-1.5 mb-2">
                <span className="text-accent/70">//</span> identity layer
              </div>
              <h1 className="font-display text-[26px] font-extrabold leading-[1.08] tracking-tight">
                One login.<br />One vault.<br />
                <span className="text-accent-light">Zero knowledge.</span>
              </h1>
              <p className="text-[13px] text-muted mt-4 leading-relaxed max-w-xs">
                This is the front door. It identifies your vault — it never holds the key.
                Your master password stays on this device.
              </p>

              <div className="mt-7 space-y-3.5">
                {FACTS.map((f) => (
                  <div key={f.title} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid place-items-center w-6 h-6 rounded-md bg-accent-dim border border-accent-border text-accent-light shrink-0">
                      {f.icon}
                    </span>
                    <div>
                      <div className="text-[12.5px] font-semibold">{f.title}</div>
                      <div className="text-[11.5px] text-muted leading-snug mt-0.5">{f.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex items-center gap-3 mt-8 mono-label">
              <span className="text-accent/80">AES-256-GCM</span>
              <span className="text-border-strong">/</span>
              <span>PBKDF2 · 310k</span>
              <span className="text-border-strong">/</span>
              <span>MIT</span>
            </div>
          </aside>

          {/* ─── Form ─── */}
          <section className="p-8 flex flex-col justify-center">
            <div className="flex md:hidden items-center gap-2.5 mb-7">
              <BrandMark size={30} glow />
              <Wordmark />
            </div>

            <div className="mono-label flex items-center gap-1.5 mb-2">
              <span className="text-accent/70">//</span> vault access
            </div>
            <h2 className="font-display text-[20px] font-bold tracking-tight">Welcome back.</h2>
            <p className="text-[12.5px] text-muted mt-1.5 mb-6 leading-relaxed">
              Use the same Google or email account as the web app and CLI.
            </p>

            {googleEnabled ? (
              <button
                className="w-full flex items-center justify-center gap-2.5 rounded-lg border border-border-strong bg-white/[0.04] hover:bg-white/[0.07] px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60"
                onClick={() => run('google')}
                disabled={busy !== null}
              >
                {busy === 'google' ? <span className="spinner" /> : <GoogleIcon />}
                {busy === 'google' ? 'Waiting for your browser…' : 'Continue with Google'}
              </button>
            ) : (
              <div className="rounded-lg border border-border bg-white/[0.02] p-3 text-[11.5px] text-subtle leading-relaxed">
                Google sign-in is not configured in this build. Use email and password below.
              </div>
            )}

            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-border" />
              <span className="mono-label">or email</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim() && password && busy === null) void run('email');
              }}
            >
              <label className="mono-label block mb-1.5" htmlFor="si-email">Email</label>
              <input
                id="si-email"
                ref={emailRef}
                className="field mb-3"
                type="email"
                placeholder="you@example.com"
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
                onKeyDown={onEscape}
                disabled={busy !== null}
              />

              <label className="mono-label block mb-1.5" htmlFor="si-password">Password</label>
              <div className="relative mb-1">
                <input
                  id="si-password"
                  className="field pr-16"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Account password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                  onKeyDown={onEscape}
                  disabled={busy !== null}
                />
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 mono-label hover:text-text transition-colors px-1.5 py-0.5"
                  onClick={() => setShowPassword((v) => !v)}
                  type="button"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'hide' : 'show'}
                </button>
              </div>

              {error ? (
                <div className="flex items-start gap-1.5 text-[12px] text-rose-400 mt-3 anim-fade-in" role="alert">
                  <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : (
                <div className="h-[18px] mt-3" />
              )}

              <button
                type="submit"
                className="btn-primary w-full mt-2"
                disabled={busy !== null || !email.trim() || !password}
              >
                {busy === 'email' ? <><span className="spinner" /> Signing in…</> : <>{busy ? 'Working…' : 'Sign in'} <FiArrowRight size={14} /></>}
              </button>
            </form>

            <div className="mt-6 rounded-lg border border-border bg-white/[0.02] p-3 flex items-start gap-2.5">
              <FiLock size={13} className="text-subtle mt-0.5 shrink-0" />
              <p className="text-[11.5px] text-muted leading-relaxed">
                <span className="text-text font-medium">This login is not your vault key.</span> It only
                authenticates you. The master password is entered next and never leaves this device.
              </p>
            </div>

            {!isTauri && (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-subtle">
                <FiAlertTriangle size={11} className="text-amber-400" />
                Browser dev mode — Google sign-in and clipboard auto-clear are unavailable.
              </div>
            )}
          </section>
        </div>
      </div>
      <div className="text-center pb-4 mono-label flex items-center justify-center gap-2">
        <Kbd>Enter</Kbd> submit <span className="text-border-strong">·</span> Esc clear field
      </div>
    </div>
  );
}
