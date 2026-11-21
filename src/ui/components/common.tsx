/**
 * Shared view building blocks: page header, filter bar, and the
 * reveal-on-click secure value display used everywhere.
 */
import { useEffect, useRef, useState } from 'react';
import { FiCopy, FiEdit2, FiEye, FiEyeOff, FiTrash2 } from 'react-icons/fi';
import type { Environment, SecretStatus, SecretType, ProjectColor } from '@/stores/uiStore.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';

const VALUE_REVEAL_MS = 15_000;

export function ViewHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <h1 className="font-display text-lg font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
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
    <select
      className="field !w-auto text-[12px] py-1.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      <option value="">{label}: all</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function ColorDot({ color }: { color: ProjectColor }) {
  const hex: Record<ProjectColor, string> = {
    violet: '#8b5cf6', blue: '#3b82f6', green: '#10b981', orange: '#f97316',
    red: '#ef4444', pink: '#ec4899', yellow: '#eab308', gray: '#6b7280',
  };
  return <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hex[color] ?? '#6b7280' }} />;
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'Active' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-800/40'
    : status === 'Rotated' ? 'text-sky-300 bg-sky-500/10 border-sky-800/40'
    : status === 'Expired' ? 'text-amber-300 bg-amber-500/10 border-amber-800/40'
    : 'text-rose-300 bg-rose-500/10 border-rose-800/40';
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>{status}</span>;
}

export function EnvPill({ environment }: { environment: string }) {
  if (!environment) return null;
  const prod = environment === 'Production';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${prod ? 'text-rose-300 bg-rose-500/10 border-rose-800/40' : 'text-muted bg-white/5 border-border'}`}>
      {environment}
    </span>
  );
}

export function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Reveal-on-click value: masked until clicked, auto-hides after 15s,
 * copy only possible while revealed. Plaintext exists only in this
 * component's state (cleared on hide/unmount). Frames one decrypted field.
 */
export function RevealValue({ decrypt, disabled, multiline }: {
  decrypt: () => Promise<string>;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearValue = () => {
    setValue(null);
    setRevealed(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { clearValue(); }, [decrypt]);

  const reveal = async () => {
    if (revealed) { clearValue(); return; }
    setBusy(true);
    setError(null);
    try {
      const v = await decrypt();
      setValue(v);
      setRevealed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(clearValue, VALUE_REVEAL_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (value === null) return;
    await copyToSystemClipboard(value);
    clearValue();
  };

  return (
    <div className="min-w-0">
      <div className="flex items-stretch gap-2">
        <div
          className={
            'flex-1 min-w-0 font-mono text-[12px] bg-black/30 border border-border rounded-lg px-3 py-2 truncate ' +
            (multiline ? 'whitespace-pre-wrap break-all max-h-40 overflow-y-auto' : '')
          }
        >
          {error ? <span className="text-rose-400">{error}</span> : revealed && value !== null ? value : '••••••••••••••••'}
        </div>
        <button
          className="btn-ghost !px-2.5"
          onClick={() => void reveal()}
          disabled={disabled || busy}
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? <FiEyeOff size={14} /> : <FiEye size={14} />}
        </button>
        <button
          className="btn-ghost !px-2.5"
          onClick={() => void copy()}
          disabled={disabled || value === null}
          title={revealed ? 'Copy' : 'Reveal first to copy'}
        >
          <FiCopy size={14} />
        </button>
      </div>
    </div>
  );
}

export function DetailActions({ onEdit, onDelete, extra }: { onEdit?: () => void; onDelete?: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      {extra}
      {onEdit && <DetailAction onClick={onEdit} icon={<FiEdit2 size={13} />} label="Edit" />}
      {onDelete && <DetailAction onClick={onDelete} icon={<FiTrash2 size={13} />} label="Delete" danger />}
    </div>
  );
}

function DetailAction({ onClick, icon, label, danger }: { onClick: () => void; icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      className={
        'inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors ' +
        (danger ? 'border-border text-muted hover:text-rose-300 hover:border-rose-800/60' : 'border-border text-muted hover:text-text hover:border-foreground')
      }
      onClick={onClick}
    >
      {icon} {label}
    </button>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex-1 grid place-items-center">
      <div className="text-center max-w-sm">
        <div className="inline-grid place-items-center w-12 h-12 rounded-xl bg-accent-dim border border-accent-border mb-4 text-accent-light">
          {icon}
        </div>
        <h2 className="font-display font-bold tracking-tight text-sm">{title}</h2>
        <p className="text-xs text-muted mt-2">{hint}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export type { Environment, SecretStatus, SecretType };
