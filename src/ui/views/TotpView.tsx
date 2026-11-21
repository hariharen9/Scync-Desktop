/**
 * TotpView — live TOTP codes with a per-token countdown. Secrets are
 * decrypted once per period boundary only; codes never auto-copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiType } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getRemainingSeconds } from '@/backend/index.js';
import { DetailActions, EmptyState, ViewHeader } from '@/ui/components/common.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function TotpView() {
  const totpTokens = useDataStore((s) => s.totpTokens);
  const openForm = useUiStore((s) => s.openForm);

  const sorted = useMemo(
    () => [...totpTokens].sort((a, b) => (a.issuer + a.label).localeCompare(b.issuer + b.label)),
    [totpTokens],
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <ViewHeader
        title="TOTP tokens"
        subtitle={`${sorted.length} token${sorted.length === 1 ? '' : 's'} · codes refresh automatically`}
        actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('totp')}><FiPlus size={13} /></button>}
      />
      {sorted.length === 0 ? (
        <EmptyState
          icon={<FiType size={20} />}
          title="No TOTP tokens"
          hint="Add a base32 secret to generate live 2FA codes, identical to the web app's tokens."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-w-4xl">
          {sorted.map((t) => (
            <TotpCard key={t.id} id={t.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function TotpCard({ id }: { id: string }) {
  const stored = useDataStore((s) => s.totpTokens.find((t) => t.id === id));
  const totpCodeFor = useDataStore((s) => s.totpCodeFor);
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const removeTotp = useDataStore((s) => s.removeTotp);
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const period = stored?.period ?? 30;
  const lastPeriod = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const secs = getRemainingSeconds(period);
      setRemaining(secs);
      // Recompute only when the code window rolls over (avoids per-second decryptions).
      const windowId = Math.floor(Date.now() / 1000 / period);
      if (windowId !== lastPeriod.current) {
        lastPeriod.current = windowId;
        try {
          const r = await totpCodeFor(id);
          if (!cancelled) { setCode(r.code); setError(null); }
        } catch (e) {
          if (!cancelled) { setCode(null); setError(e instanceof Error ? e.message : String(e)); }
        }
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [id, period, totpCodeFor]);

  if (!stored) return null;

  const doDelete = () => askConfirm({
    title: 'Remove TOTP token',
    message: `Remove "${stored.issuer} · ${stored.label}"? This cannot be undone.`,
    confirmText: 'Remove',
    danger: true,
    onConfirm: () => {
      void removeTotp(stored.id)
        .then(() => pushToast('Token removed'))
        .catch((e) => pushToast('Remove failed', e instanceof Error ? e.message : String(e)));
    },
  });

  const pct = (remaining / period) * 100;
  const low = remaining <= 5;

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{stored.issuer || 'Token'}</div>
          <div className="text-[11px] text-subtle truncate">{stored.label}</div>
        </div>
        <DetailActions onEdit={() => openForm('totp', stored.id)} onDelete={doDelete} />
      </div>
      <button
        className="font-mono text-[22px] tracking-[0.2em] text-left w-full hover:text-accent-light transition-colors disabled:text-muted"
        disabled={!code}
        onClick={() => code && void copyToSystemClipboard(code, 'Code copied')}
        title={code ? 'Click to copy' : error ?? 'Deriving…'}
      >
        {code ? code : '••• •••'}
      </button>
      <div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className={'h-full rounded-full transition-[width] duration-1000 ease-linear ' + (low ? 'bg-rose-400' : 'bg-accent')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 mono-label">
        <span>{stored.algorithm} · {stored.digits}d · {period}s</span>
        <span className={low ? 'text-rose-300' : ''}>{remaining}s</span>
      </div>
      {error && <div className="text-[11px] text-rose-400 mt-2">{error}</div>}
    </div>
  );
}
