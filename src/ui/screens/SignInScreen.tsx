/**
 * Sign-in gate: Google (loopback via Rust) + email/password, in the web
 * app's visual language. Footer states honestly that the master password is
 * separate and unrecoverable.
 */
import { useState } from 'react';
import { FiLock } from 'react-icons/fi';
import { signInWithGoogle, signInWithEmail } from '@/auth/session.js';
import { isGoogleLoginEnabled } from '@/backend/firebase.js';
import { isTauri } from '@/auth/bridge.js';

function authErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password')) {
    return 'Incorrect email or password.';
  }
  if (msg.includes('auth/user-not-found')) return 'No account with that email.';
  if (msg.includes('auth/too-many-requests')) return 'Too many attempts — wait a moment and retry.';
  if (msg.includes('auth/network-request-failed')) return 'Network error — check your connection.';
  if (msg.startsWith('SCYNC_DEV')) return 'Not running inside the Scync desktop shell.';
  return msg;
}

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-grid place-items-center w-12 h-12 rounded-xl bg-accent-dim border border-accent-border mb-3">
            <FiLock className="text-accent-light" size={22} />
          </div>
          <h1 className="font-display text-xl font-bold tracking-tight">Sign in to Scync</h1>
          <p className="text-xs text-muted mt-2">
            Same Google or email account as the web app and CLI. The vault master password is
            separate and unrecoverable.
          </p>
        </div>

        {isGoogleLoginEnabled() ? (
          <button
            className={isTauri ? 'btn-ghost w-full mb-3' : 'btn-ghost w-full mb-3 opacity-60'}
            onClick={() => run('google')}
            disabled={busy !== null}
          >
            {busy === 'google' ? 'Waiting for browser…' : 'Continue with Google'}
          </button>
        ) : (
          <div className="text-center text-xs text-subtle border border-border rounded-lg p-3 mb-3">
            Google sign-in is disabled in this build (no client configured).
          </div>
        )}

        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1 bg-border" />
          <span className="mono-label">or email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <input
          className="field mb-3"
          type="email"
          placeholder="you@example.com"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="relative mb-1">
          <input
            className="field pr-14"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run('email');
            }}
          />
          <button
            className="mono-label absolute right-3 top-1/2 -translate-y-1/2 hover:text-muted"
            onClick={() => setShowPassword(!showPassword)}
            type="button"
          >
            {showPassword ? 'hide' : 'show'}
          </button>
        </div>

        {error && <div className="text-xs text-rose-400 mt-3 text-center">{error}</div>}

        <button
          className="btn-primary w-full mt-4"
          onClick={() => run('email')}
          disabled={busy !== null || !email || !password}
        >
          {busy === 'email' ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
