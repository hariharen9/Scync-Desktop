/**
 * Shared view building blocks: page headers, filter bars, pills, and the
 * reveal-on-click secure value used everywhere. Presentation only — the
 * decrypt callbacks are supplied by each view.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FiCheck, FiCopy, FiEdit2, FiEye, FiEyeOff, FiTrash2 } from 'react-icons/fi';
import type { Environment, SecretStatus, SecretType, ProjectColor } from '@/stores/uiStore.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { Chip, CopyIconButton } from './primitives.js';

const VALUE_REVEAL_MS = 15_000;

export function ViewHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div className="min-w-0">
        <h1 className="font-display text-[19px] font-bold tracking-tight leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function PageHeader({ kicker, title, subtitle, actions }: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-5 anim-fade-up">
      <div className="min-w-0">
        {kicker && (
          <div className="mono-label flex items-center gap-1.5 mb-1.5">
            <span className="text-accent/70">//</span> {kicker}
          </div>
        )}
        <h1 className="font-display text-[20px] font-bold tracking-tight leading-tight truncate">{title}</h1>
        {subtitle && <div className="text-[12.5px] text-muted mt-1.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SelectFilter({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        className="appearance-none text-[12px] bg-white/[0.03] border border-border rounded-lg pl-2.5 pr-7 py-1.5 text-muted hover:text-text hover:border-border-strong transition-colors outline-none focus:border-accent-border"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='6'%3E%3Cpath d='M0 0l4.5 6L9 0z' fill='%2355637a'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 9px center',
        }}
      >
        <option value="" className="bg-panel">{label}: all</option>
        {options.map((o) => <option key={o} value={o} className="bg-panel">{o}</option>)}
      </select>
    </div>
  );
}

export function ColorDot({ color }: { color: ProjectColor }) {
  const hex: Record<ProjectColor, string> = {
    violet: '#8b5cf6', blue: '#3b82f6', green: '#10b981', orange: '#f97316',
    red: '#ef4444', pink: '#ec4899', yellow: '#eab308', gray: '#6b7280',
  };
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: hex[color] ?? '#6b7280', boxShadow: `0 0 8px ${hex[color] ?? '#6b7280'}55` }}
    />
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Active' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
    : status === 'Rotated' ? 'text-sky-300 bg-sky-500/10 border-sky-500/25'
    : status === 'Expired' ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
    : 'text-rose-300 bg-rose-500/10 border-rose-500/25';
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>{status}</span>;
}

export function EnvPill({ environment }: { environment: string }) {
  if (!environment) return null;
  const prod = environment === 'Production';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${prod ? 'text-rose-300 bg-rose-500/10 border-rose-500/25' : 'text-muted bg-white/[0.04] border-border'}`}>
      {environment}
    </span>
  );
}

export function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Reveal-on-click value.
 *
 *   • Reveal decrypts on demand and auto-hides after 15s (countdown shown).
 *   • Copy decrypts in the background and writes straight to the clipboard
 *     without ever painting the plaintext — the CLI's `get` ergonomics, with
 *     the desktop's auto-clear clipboard.
 * Plaintext lives only in this component's state while revealed.
 */
export function RevealValue({ decrypt, disabled, multiline, copyLabel = 'Copy' }: {
  decrypt: () => Promise<string>;
  disabled?: boolean;
  multiline?: boolean;
  copyLabel?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearValue = () => {
    setValue(null);
    setRevealed(false);
    setRemaining(0);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (ticker.current) { clearInterval(ticker.current); ticker.current = null; }
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (ticker.current) clearInterval(ticker.current);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  useEffect(() => { clearValue(); }, [decrypt]);

  const startCountdown = () => {
    const deadline = Date.now() + VALUE_REVEAL_MS;
    setRemaining(Math.ceil(VALUE_REVEAL_MS / 1000));
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) clearValue();
    }, 250);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(clearValue, VALUE_REVEAL_MS);
  };

  const reveal = async () => {
    if (revealed) { clearValue(); return; }
    setBusy(true);
    setError(null);
    try {
      const v = await decrypt();
      setValue(v);
      setRevealed(true);
      startCountdown();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    setError(null);
    try {
      const v = value ?? (await decrypt());
      await copyToSystemClipboard(v, copyLabel);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const hasKnownValue = value !== null;
  const showing = revealed && value !== null;

  return (
    <div className="min-w-0">
      <div className="flex items-stretch gap-2">
        <div
          className={
            'group flex-1 min-w-0 font-mono text-[12px] bg-black/40 border border-border rounded-lg px-3 py-2 selectable transition-colors ' +
            (multiline ? 'whitespace-pre-wrap break-all max-h-44 overflow-y-auto' : '') +
            (showing ? ' border-accent-border/60' : '')
          }
        >
          {error ? (
            <span className="text-rose-400">{error}</span>
          ) : showing ? (
            <span className="text-accent-mute/90">{value}</span>
          ) : (
            <span className="text-subtle tracking-[0.18em]">••••••••••••••••</span>
          )}
          {!multiline && showing && remaining > 0 && (
            <span className="mono-label float-right ml-2 pt-0.5">{remaining}s</span>
          )}
        </div>
        <div className="flex items-stretch gap-1">
          <button
            type="button"
            className={
              'px-2.5 rounded-lg border transition-colors ' +
              (showing
                ? 'border-accent-border text-accent-light bg-accent-dim'
                : 'border-border text-muted hover:text-text hover:border-border-strong')
            }
            onClick={() => void reveal()}
            disabled={disabled || busy}
            title={showing ? 'Hide' : 'Reveal'}
            aria-label={showing ? 'Hide value' : 'Reveal value'}
          >
            {busy ? <span className="spinner" /> : showing ? <FiEyeOff size={14} /> : <FiEye size={14} />}
          </button>
          <button
            type="button"
            className="px-2.5 rounded-lg border border-border text-muted hover:text-text hover:border-border-strong transition-colors"
            onClick={() => void copy()}
            disabled={disabled || busy}
            title={hasKnownValue ? 'Copy to clipboard' : 'Decrypt and copy'}
            aria-label="Copy to clipboard"
          >
            {copied ? <FiCheck size={14} className="text-accent-light" /> : <FiCopy size={14} />}
          </button>
        </div>
      </div>
      {multiline && showing && remaining > 0 && (
        <div className="mono-label mt-1 text-right">auto-hides in {remaining}s</div>
      )}
    </div>
  );
}

export function DetailActions({ onEdit, onDelete, extra }: { onEdit?: () => void; onDelete?: () => void; extra?: ReactNode }) {
  return (
    <div className="flex gap-2">
      {extra}
      {onEdit && <DetailAction onClick={onEdit} icon={<FiEdit2 size={13} />} label="Edit" />}
      {onDelete && <DetailAction onClick={onDelete} icon={<FiTrash2 size={13} />} label="Delete" danger />}
    </div>
  );
}

function DetailAction({ onClick, icon, label, danger }: { onClick: () => void; icon: ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      className={
        'inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors ' +
        (danger
          ? 'border-border text-muted hover:text-rose-300 hover:border-rose-500/50 hover:bg-rose-500/5'
          : 'border-border text-muted hover:text-text hover:border-border-strong')
      }
      onClick={onClick}
    >
      {icon} {label}
    </button>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center anim-fade-in">
      <div className="text-center max-w-sm px-6">
        <div className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-accent-dim border border-accent-border mb-4 text-accent-light">
          {icon}
        </div>
        <h2 className="font-display font-bold tracking-tight text-[15px]">{title}</h2>
        <p className="text-[12.5px] text-muted mt-2 leading-relaxed">{hint}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

/** Detail row used by every detail panel; consistent rhythm. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2.5 border-b border-border last:border-0">
      <span className="mono-label w-28 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </div>
  );
}

/** Small copyable inline value (fingerprint, username, URL, host). */
export function CopyableText({ value, mono = true, label = 'Copy' }: { value: string; mono?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span className={`truncate ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</span>
      <CopyIconButton size={12} label={label} onCopy={() => copyToSystemClipboard(value, `${label} copied`)} />
    </span>
  );
}

/** Info tint used for the "needs attention" style blocks. */
export function AlertBlock({ tone = 'warn', icon, children }: { tone?: 'warn' | 'danger' | 'accent'; icon?: ReactNode; children: ReactNode }) {
  const cls = tone === 'danger'
    ? 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200'
    : tone === 'accent'
      ? 'border-accent-border bg-accent-dim text-accent-mute'
      : 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200';
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed ${cls}`}>
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export { Chip };

export type { Environment, SecretStatus, SecretType };
