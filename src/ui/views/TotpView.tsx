/**
 * TotpView — live TOTP codes with a per-token countdown ring. Secrets are
 * decrypted once per period boundary only; codes never auto-copy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiCheck, FiCopy, FiPlus, FiSearch, FiType, FiX } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getRemainingSeconds } from '@/backend/index.js';
import { DetailActions, EmptyState, PageHeader } from '@/ui/components/common.js';
import { Chip, Spinner } from '@/ui/components/primitives.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

export default function TotpView() {
  const totpTokens = useDataStore((s) => s.totpTokens);
  const loaded = useDataStore((s) => s.loaded);
  const openForm = useUiStore((s) => s.openForm);
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...totpTokens]
      .filter((t) => !q || `${t.issuer} ${t.label}`.toLowerCase().includes(q))
      .sort((a, b) => (a.issuer + a.label).localeCompare(b.issuer + b.label));
  }, [totpTokens, query]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        <PageHeader
          title="Authenticator"
          subtitle={`${totpTokens.length} token${totpTokens.length === 1 ? '' : 's'} · RFC 6238 · codes refresh automatically`}
          actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('totp')}><FiPlus size={13} /> New</button>}
        />

        {totpTokens.length > 0 && (
          <div className="relative mb-4 max-w-xs">
            <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
            <input
              className="field pl-9 pr-9"
              placeholder="Filter tokens…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            />
            {query && (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text" onClick={() => setQuery('')} aria-label="Clear"><FiX size={13} /></button>
            )}
          </div>
        )}

        {!loaded.totpTokens ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-w-4xl">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-[132px] skeleton" />)}
          </div>
        ) : totpTokens.length === 0 ? (
          <EmptyState
            icon={<FiType size={20} />}
            title="No authenticator tokens"
            hint="Add a base32 secret to generate live 2FA codes, identical to the web app's tokens."
            action={<button className="btn-primary !text-[12px]" onClick={() => openForm('totp')}><FiPlus size={12} /> Add token</button>}
          />
        ) : sorted.length === 0 ? (
          <div className="text-center text-muted text-[12.5px] mt-10">No tokens match “{query}”.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-w-4xl">
            {sorted.map((t, i) => <TotpCard key={t.id} id={t.id} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function TotpCard({ id, index }: { id: string; index: number }) {
  const stored = useDataStore((s) => s.totpTokens.find((t) => t.id === id));
  const totpCodeFor = useDataStore((s) => s.totpCodeFor);
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const removeTotp = useDataStore((s) => s.removeTotp);
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const period = stored?.period ?? 30;
  const lastPeriod = useRef(-1);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      setRemaining(getRemainingSeconds(period));
      const windowId = Math.floor(Date.now() / 1000 / period);
      // Recompute on a window rollover, or on the first tick after mount when
      // we hold no code yet (covers StrictMode remounts). A failed derive is
      // not retried every second — the next window or a manual remount retries.
      if (windowId !== lastPeriod.current || (code === null && error === null)) {
        lastPeriod.current = windowId;
        void totpCodeFor(id)
          .then((r) => { if (!cancelled) { setCode(r.code); setError(null); } })
          .catch((e) => { if (!cancelled) { setCode(null); setError(e instanceof Error ? e.message : String(e)); } });
      }
    };
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (t !== null) return;
      tick();
      t = setInterval(tick, 1000);
    };
    const stop = () => {
      if (t !== null) {
        clearInterval(t);
        t = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [id, period, totpCodeFor, code, error]);

  if (!stored) return null;

  const doDelete = () => askConfirm({
    title: 'Remove TOTP token',
    message: `Remove "${stored.issuer} · ${stored.label}"? This cannot be undone.`,
    confirmText: 'Remove',
    danger: true,
    onConfirm: () => {
      void removeTotp(stored.id)
        .then(() => pushToast.success('Token removed'))
        .catch((e) => pushToast.fromError(e));
    },
  });

  const low = remaining <= 5;
  const frac = remaining / period;
  const grouped = code ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}` : '';

  const copy = () => {
    if (!code) return;
    void copyToSystemClipboard(code, 'Code copied');
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="card p-4 hover:border-border-strong transition-colors anim-fade-up" style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{stored.issuer || 'Token'}</div>
          <div className="text-[11px] text-subtle truncate">{stored.label}</div>
        </div>
        <DetailActions onEdit={() => openForm('totp', stored.id)} onDelete={doDelete} />
      </div>

      <div className="flex items-center gap-3">
        <button
          className="flex-1 min-w-0 text-left group"
          disabled={!code}
          onClick={copy}
          title={code ? 'Click to copy' : error ?? 'Deriving…'}
        >
          <span className={'font-mono text-[24px] font-bold tracking-[0.12em] tabular-nums transition-colors ' + (code ? (low ? 'text-rose-400 group-hover:text-rose-300' : 'text-accent-light group-hover:text-accent-mute') : 'text-muted')}>
            {code ? grouped : '••• •••'}
          </span>
        </button>

        {/* Countdown ring */}
        <div className="relative w-9 h-9 shrink-0 grid place-items-center">
          <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0">
            <circle cx="18" cy="18" r={RING_R} fill="none" strokeWidth="2.5" className="ring-track" />
            <circle
              cx="18" cy="18" r={RING_R} fill="none" strokeWidth="2.5"
              strokeLinecap="round"
              className="ring-value"
              stroke={low ? '#f43f5e' : '#10b981'}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - frac)}
            />
          </svg>
          <span className={'font-mono text-[10px] tabular-nums ' + (low ? 'text-rose-300' : 'text-muted')}>{remaining}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-1.5">
          <Chip>{stored.algorithm}</Chip>
          <Chip>{stored.digits} digits</Chip>
          <Chip>{period}s</Chip>
        </div>
        <button
          className="icon-btn !w-7 !h-7"
          onClick={copy}
          disabled={!code}
          title={copied ? 'Copied' : 'Copy code'}
          aria-label="Copy code"
        >
          {copied ? <FiCheck size={13} className="text-accent-light" /> : code ? <FiCopy size={13} /> : <Spinner />}
        </button>
      </div>
      {error && <div className="text-[11px] text-rose-400 mt-2">{error}</div>}
    </div>
  );
}
