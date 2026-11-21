/**
 * Unlock screen: PBKDF2 unlock with progress state, client-side rate
 * limiting (5 attempts then exponential backoff), lockout counter.
 */
import { useEffect, useState } from 'react';
import { useVaultStore, retryDelayMs } from '@/stores/vaultStore.js';

export default function UnlockScreen({
  email,
  unlocking,
  onSignOut,
}: {
  email: string;
  unlocking: boolean;
  onSignOut?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const failedAttempts = useVaultStore((s) => s.failedAttempts);
  const nextAttemptAllowedAt = useVaultStore((s) => s.nextAttemptAllowedAt);
  const error = useVaultStore((s) => s.error);
  const unlock = useVaultStore((s) => s.unlock);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const waitSecs = Math.max(0, Math.ceil((nextAttemptAllowedAt - nowMs) / 1000));
  const rateLimited = waitSecs > 0;
  const delayedError =
    failedAttempts >= 5 ? `Vault locks out for ${Math.ceil(retryDelayMs(failedAttempts) / 1000)}s after failed attempts.` : null;

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="card w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-grid place-items-center w-12 h-12 rounded-xl bg-accent-dim border border-accent-border mb-3">
            <span className="font-display font-extrabold text-accent-light text-lg">S</span>
          </div>
          <h1 className="font-display text-lg font-bold tracking-tight">Unlock your vault</h1>
          <p className="text-xs text-muted mt-2 break-all">{email}</p>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            autoFocus
            className="field flex-1"
            type={show ? 'text' : 'password'}
            placeholder="Master password"
            value={password}
            disabled={unlocking || rateLimited}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password && !unlocking && !rateLimited) void unlock(password);
            }}
          />
          <button type="button" className="btn-ghost" onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>

        {(error || delayedError) && (
          <div className="text-xs text-rose-400 text-center mb-2">{rateLimited ? `Wait ${waitSecs}s` : error ?? delayedError}</div>
        )}

        <button
          className="btn-primary w-full"
          disabled={unlocking || rateLimited || !password}
          onClick={() => void unlock(password)}
        >
          {unlocking ? 'Deriving key…' : 'Unlock'}
        </button>

        <p className="mono-label text-center mt-6">
          {unlocking ? 'PBKDF2-SHA256 · 310,000 iterations' : 'zero-knowledge · key stays in memory'}
        </p>
        {onSignOut && (
          <button className="btn-ghost w-full mt-2" onClick={onSignOut} disabled={unlocking}>
            Use a different account
          </button>
        )}
      </div>
    </div>
  );
}
