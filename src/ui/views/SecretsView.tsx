/**
 * SecretsView — filterable, project-grouped list with a detail pane.
 *
 * Desktop-first and size-proof:
 *   • Wide panes show list + detail side by side.
 *   • Narrow panes collapse to a single pane: the list, or the selected
 *     secret with a Back action. The split is driven by the container's own
 *     width (ResizeObserver), not the viewport, so it behaves correctly
 *     whatever chrome surrounds it.
 *   • Rows are compact (name + one metadata line) with a status dot; the
 *     heavy pill stack lives only in the detail header.
 * Keyboard: ↑/↓ move selection, / focuses search, Esc deselects.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FiAlertTriangle, FiChevronLeft, FiDatabase, FiEdit2, FiPlus, FiSearch,
  FiShare2, FiTrash2, FiX,
} from 'react-icons/fi';
import { useUiStore, type ProjectColor } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getAttentionSecrets } from '@/backend/index.js';
import {
  AlertBlock, ColorDot, EmptyState, RevealValue, formatDate,
} from '@/ui/components/common.js';
import { Chip, ListSkeleton, Skeleton } from '@/ui/components/primitives.js';
import { SPLIT_MIN, useElementWidth } from '@/ui/components/masterDetail.js';
import { pushToast } from '@/ui/components/Toast.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import type { StoredSecret } from '@/backend/index.js';

const ENVIRONMENTS = ['Personal', 'Work', 'Development', 'Staging', 'Production', 'Local', 'Testing', 'CI/CD'];
const STATUSES = ['Active', 'Rotated', 'Expired', 'Revoked'];
const SECRET_TYPES = ['API Key', 'Personal Access Token', 'OAuth Token', 'OAuth Client Secret', 'Recovery Codes', 'Secret Key', 'Webhook Secret', 'Service Account JSON', 'Database URL', 'License Key', 'Passphrase', 'Secret Note', 'Password', 'Other'];

const STATUS_DOT: Record<string, string> = {
  Active: 'bg-emerald-400',
  Rotated: 'bg-sky-400',
  Expired: 'bg-amber-400',
  Revoked: 'bg-rose-400',
};
const STATUS_TEXT: Record<string, string> = {
  Active: 'text-emerald-300/90',
  Rotated: 'text-sky-300/90',
  Expired: 'text-amber-300/90',
  Revoked: 'text-rose-300/90',
};

export default function SecretsView() {
  const secrets = useDataStore((s) => s.secrets);
  const projects = useDataStore((s) => s.projects);
  const loaded = useDataStore((s) => s.loaded);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const searchRef = useRef<HTMLInputElement>(null);
  const [rootRef, width] = useElementWidth<HTMLDivElement>();

  // Attention map: id → short reason, for the row indicator tooltip.
  const attention = getAttentionSecrets(secrets);
  const attentionReason = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of attention.expired) map.set(s.id, `Expired ${formatDate(s.expiresOn)}`);
    for (const s of attention.expiringSoon) map.set(s.id, `Expires ${formatDate(s.expiresOn)}`);
    for (const s of attention.rotationOverdue) map.set(s.id, `Rotation overdue since ${formatDate(s.lastRotated)}`);
    for (const s of attention.recoveryCodesLow) map.set(s.id, `Only ${s.remainingCodes} recovery code(s) left`);
    return map;
  }, [attention]);

  const filtered = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    const filterProject = filter.projectId ? projects.find((p) => p.name === filter.projectId) : null;
    return secrets.filter((s) => {
      if (filter.service && s.service !== filter.service) return false;
      if (filter.type && s.type !== filter.type) return false;
      if (filter.environment && s.environment !== filter.environment) return false;
      if (filter.status && s.status !== filter.status) return false;
      if (filter.projectId && s.projectId !== (filterProject?.id ?? filter.projectId)) return false;
      if (q && !`${s.name} ${s.service} ${s.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [secrets, filter, projects]);

  const services = useMemo(() => [...new Set(secrets.map((s) => s.service))].sort(), [secrets]);

  const groups = useMemo(() => {
    const map = new Map<string, StoredSecret[]>();
    for (const secret of filtered) {
      const key = secret.projectId ?? '';
      const list = map.get(key) ?? [];
      list.push(secret);
      map.set(key, list);
    }
    return [...map.entries()].map(([projectId, list]) => ({
      project: projects.find((p) => p.id === projectId) ?? null,
      list: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => (a.project?.name ?? '').localeCompare(b.project?.name ?? ''));
  }, [filtered, projects]);

  const ordered = useMemo(() => groups.flatMap((g) => g.list), [groups]);
  // Selection resolves against ALL secrets, so a selected item stays visible
  // in the detail pane even while the active filters hide it from the list.
  const selected = secrets.find((s) => s.id === selectedId) ?? null;
  const activeFilters = [filter.service, filter.type, filter.environment, filter.status, filter.projectId].filter(Boolean).length;
  const hasFilters = activeFilters > 0 || filter.search.trim() !== '';

  const compact = width > 0 && width < SPLIT_MIN;
  const showList = !compact || !selected;
  const showDetail = !compact || Boolean(selected);

  // Keyboard list navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'select') return;
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (ordered.length === 0) return;
        e.preventDefault();
        const idx = ordered.findIndex((s) => s.id === selectedId);
        const next = e.key === 'ArrowDown'
          ? Math.min(ordered.length - 1, idx < 0 ? 0 : idx + 1)
          : Math.max(0, idx <= 0 ? 0 : idx - 1);
        const target = ordered[next];
        if (target) { selectSecret(target.id); document.getElementById(`secret-row-${target.id}`)?.scrollIntoView({ block: 'nearest' }); }
      }
      if (e.key === 'Escape' && selectedId) selectSecret(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selectedId, selectSecret]);

  const listWidth = width >= 1200 ? 380 : 330;

  return (
    <div ref={rootRef} className="h-full flex min-w-0 overflow-hidden">
      {/* ─── List pane ─── */}
      {showList && (
        <section
          className={
            'flex flex-col min-w-0 ' +
            (compact ? 'flex-1' : 'shrink-0 border-r border-border')
          }
          style={compact ? undefined : { width: listWidth }}
        >
          {/* Header + controls */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h1 className="font-display text-[17px] font-bold tracking-tight leading-none">Secrets</h1>
                <p className="mono-label mt-1.5">
                  {filtered.length} of {secrets.length}
                  {activeFilters > 0 && <span className="text-accent-light"> · {activeFilters} filter{activeFilters > 1 ? 's' : ''}</span>}
                </p>
              </div>
              <button
                className="btn-primary !py-1.5 !px-3 text-[12px] shrink-0"
                onClick={() => openForm('secret')}
              >
                <FiPlus size={13} /> New
              </button>
            </div>

            <div className="relative mb-2">
              <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
              <input
                ref={searchRef}
                className="field pl-9 pr-9"
                placeholder="Search name, service, type…"
                value={filter.search}
                onChange={(e) => setFilter({ search: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') { setFilter({ search: '' }); e.currentTarget.blur(); } }}
              />
              {filter.search ? (
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text" onClick={() => setFilter({ search: '' })} aria-label="Clear search">
                  <FiX size={13} />
                </button>
              ) : (
                <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 hide-scrollbar">
              <FilterChip label="Service" value={filter.service} onChange={(v) => setFilter({ service: v })} options={services} />
              <FilterChip label="Type" value={filter.type} onChange={(v) => setFilter({ type: v as typeof filter.type })} options={SECRET_TYPES} />
              <FilterChip label="Env" value={filter.environment} onChange={(v) => setFilter({ environment: v as typeof filter.environment })} options={ENVIRONMENTS} />
              <FilterChip label="Status" value={filter.status} onChange={(v) => setFilter({ status: v as typeof filter.status })} options={STATUSES} />
              <FilterChip label="Project" value={filter.projectId} onChange={(v) => setFilter({ projectId: v })} options={projects.map((p) => p.name)} />
              {hasFilters && (
                <button className="shrink-0 text-[11px] text-muted hover:text-text px-1.5 py-1" onClick={clearFilters}>clear</button>
              )}
            </div>
          </div>

          {/* Rows */}
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {!loaded.secrets ? (
              <ListSkeleton rows={9} />
            ) : groups.length === 0 ? (
              <div className="text-center px-4 mt-12">
                <p className="text-[12.5px] text-muted">{hasFilters ? 'No secrets match these filters.' : 'No secrets yet.'}</p>
                {hasFilters ? (
                  <button className="text-[11.5px] text-accent-light hover:underline mt-2" onClick={clearFilters}>Clear filters</button>
                ) : (
                  <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('secret')}><FiPlus size={12} /> Add secret</button>
                )}
              </div>
            ) : (
              groups.map(({ project, list }) => (
                <div key={project?.id ?? 'none'} className="mb-2">
                  <div className="sticky top-0 z-10 -mx-2 bg-bg/95 px-2 py-1.5 backdrop-blur-sm flex items-center gap-1.5 mono-label">
                    {project ? <><ColorDot color={project.color as ProjectColor} /> {project.name}</> : 'Uncategorized'}
                    <span className="text-subtle/70">· {list.length}</span>
                  </div>
                  {list.map((s) => (
                    <SecretRow
                      key={s.id}
                      secret={s}
                      selected={s.id === selectedId}
                      attention={attentionReason.get(s.id)}
                      onSelect={() => selectSecret(s.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* ─── Detail pane ─── */}
      {showDetail && (
        selected ? (
          <SecretDetail
            key={selected.id}
            secret={selected}
            compact={compact}
            onBack={() => selectSecret(null)}
          />
        ) : (
          <div className="flex-1 min-w-0 flex flex-col">
            {!loaded.secrets ? (
              <div className="max-w-xl space-y-4 p-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            ) : (
              <EmptyState
                icon={<FiDatabase size={20} />}
                title="Select a secret"
                hint="Pick a secret from the list, or create a new one. Values stay encrypted until you reveal them."
                action={<button className="btn-ghost !text-[12px]" onClick={() => openForm('secret')}><FiPlus size={12} /> New secret</button>}
              />
            )}
          </div>
        )
      )}
    </div>
  );
}

// ─── List row ───────────────────────────────────────────────────────────────

function SecretRow({ secret, selected, attention, onSelect }: {
  secret: StoredSecret;
  selected: boolean;
  attention?: string;
  onSelect: () => void;
}) {
  return (
    <button
      id={`secret-row-${secret.id}`}
      onClick={onSelect}
      title={attention ? `Needs attention — ${attention}` : undefined}
      className={
        'group w-full text-left rounded-lg border px-2.5 py-1.5 mb-0.5 transition-colors ' +
        (selected
          ? 'bg-accent-dim border-accent-border'
          : 'border-transparent hover:bg-white/[0.04]')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (STATUS_DOT[secret.status] ?? 'bg-subtle')} />
        <span className={'text-[12.5px] font-medium truncate flex-1 ' + (selected ? 'text-text' : 'text-text/90')}>
          {secret.name}
        </span>
        {attention && <FiAlertTriangle size={11} className="text-amber-400 shrink-0" />}
      </div>
      <div className="flex items-center gap-1.5 mt-0.5 min-w-0 pl-3.5">
        <span className="text-[10.5px] text-subtle truncate">{secret.service}</span>
        <span className="text-[10px] text-border-strong shrink-0">·</span>
        <span className="text-[10.5px] text-subtle truncate shrink-0">{secret.environment}</span>
        <span className={'ml-auto text-[10px] font-mono shrink-0 ' + (STATUS_TEXT[secret.status] ?? 'text-subtle')}>
          {secret.status}
        </span>
      </div>
    </button>
  );
}

// ─── Compact filter dropdown ───────────────────────────────────────────────

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%236b7890'/%3E%3C/svg%3E\")";

function FilterChip({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const active = value !== '';
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={
        'appearance-none shrink-0 cursor-pointer rounded-md border py-1 pl-2 pr-6 text-[11.5px] outline-none transition-colors focus:border-accent-border ' +
        (active
          ? 'border-accent-border bg-accent-dim text-accent-light'
          : 'border-border bg-white/[0.03] text-muted hover:text-text hover:border-border-strong')
      }
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 7px center' }}
    >
      <option value="" className="bg-panel">{label}</option>
      {options.map((o) => <option key={o} value={o} className="bg-panel">{o}</option>)}
    </select>
  );
}

// ─── Detail pane ────────────────────────────────────────────────────────────

function SecretDetail({ secret, compact, onBack }: {
  secret: StoredSecret;
  compact: boolean;
  onBack: () => void;
}) {
  const projects = useDataStore((s) => s.projects);
  const shares = useDataStore((s) => s.shares);
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptSecretById = useDataStore((s) => s.decryptSecretById);
  const removeSecret = useDataStore((s) => s.removeSecret);
  const removeShare = useDataStore((s) => s.removeShare);
  const [sharing, setSharing] = useState(false);

  const stored = secret;
  const project = stored.projectId ? projects.find((p) => p.id === stored.projectId) : null;
  const secretShares = shares.filter((sh) => sh.projectId === stored.projectId && sh.encValue && sh.secretName === stored.name);
  const now = Date.now();
  const expired = stored.expiresOn !== null && stored.expiresOn.getTime() < now;
  const expiringSoon = !expired && stored.expiresOn !== null && stored.expiresOn.getTime() - now < 30 * 24 * 3600 * 1000;
  const lowCodes = stored.type === 'Recovery Codes' && stored.remainingCodes !== null && stored.remainingCodes <= 2;

  const doDelete = () => askConfirm({
    title: 'Delete secret',
    message: `Permanently delete "${stored.name}" (${stored.service})? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeSecret(stored.id, stored.name, stored.service)
        .then(() => { selectSecret(null); pushToast.success('Secret deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Sticky header: identity + actions stay reachable while scrolling */}
      <header className="flex items-start gap-2 px-5 md:px-6 pt-5 pb-3.5 border-b border-border">
        {compact && (
          <button className="icon-btn shrink-0 mt-0.5" onClick={onBack} title="Back to list" aria-label="Back to list">
            <FiChevronLeft size={18} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-display text-[18px] font-bold tracking-tight truncate">{stored.name}</h1>
            {expired && <Chip tone="danger">expired</Chip>}
            {expiringSoon && <Chip tone="warn">expiring</Chip>}
            {lowCodes && <Chip tone="danger">low codes</Chip>}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className={'w-1.5 h-1.5 rounded-full ' + (STATUS_DOT[stored.status] ?? 'bg-subtle')} />
              {stored.status}
            </span>
            <span className="text-[10px] text-border-strong">·</span>
            <span className="text-[11px] text-muted">{stored.environment}</span>
            <span className="text-[10px] text-border-strong">·</span>
            <span className="text-[11px] text-muted truncate">{stored.type}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button className="icon-btn" onClick={() => setSharing(true)} title="Share" aria-label="Share"><FiShare2 size={15} /></button>
          <button className="icon-btn" onClick={() => openForm('secret', stored.id)} title="Edit" aria-label="Edit"><FiEdit2 size={15} /></button>
          <button className="icon-btn icon-btn-danger" onClick={doDelete} title="Delete" aria-label="Delete"><FiTrash2 size={15} /></button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-5 md:p-6">
          {(expired || expiringSoon || lowCodes) && (
            <div className="mb-4">
              <AlertBlock
                tone={expired || lowCodes ? 'danger' : 'warn'}
                icon={<FiAlertTriangle size={13} className="mt-0.5 shrink-0" />}
              >
                {expired
                  ? `This secret expired on ${formatDate(stored.expiresOn)}. Rotate it and update the entry.`
                  : expiringSoon
                    ? `This secret expires on ${formatDate(stored.expiresOn)}. Plan a rotation.`
                    : `Only ${stored.remainingCodes} recovery code(s) remain. Regenerate the set.`}
              </AlertBlock>
            </div>
          )}

          {/* Primary value */}
          <section className="card p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="mono-label">Value</span>
              <span className="mono-label text-subtle/70 truncate max-w-[60%] text-right">{stored.service}</span>
            </div>
            <RevealValue decrypt={() => decryptSecretById(stored.id).then((d) => d.value)} />
          </section>

          {/* Metadata — auto-fitting grid so it uses width instead of a long column */}
          <section className="card px-4 py-3.5 mb-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: '1.5rem' }}>
            <Meta label="Project">
              {project
                ? <span className="inline-flex items-center gap-1.5"><ColorDot color={project.color as ProjectColor} /> {project.name}</span>
                : <span className="text-subtle">—</span>}
            </Meta>
            <Meta label="Environment">{stored.environment}</Meta>
            <Meta label="Type">{stored.type}</Meta>
            <Meta label="Status">{stored.status}</Meta>
            <Meta label="Last rotated">{stored.lastRotated ? formatDate(stored.lastRotated) : <span className="text-subtle">—</span>}</Meta>
            <Meta label="Expires">{stored.expiresOn ? formatDate(stored.expiresOn) : <span className="text-subtle">—</span>}</Meta>
            {stored.type === 'Recovery Codes' && stored.remainingCodes !== null && (
              <Meta label="Remaining codes">{stored.remainingCodes}</Meta>
            )}
            <Meta label="Updated">{formatDate(stored.updatedAt)}</Meta>
          </section>

          {/* Notes — only offer reveal/copy when a note actually exists */}
          <section className="card p-4 mb-4">
            <div className="mono-label mb-2">Notes</div>
            {stored.encNotes ? (
              <RevealValue decrypt={() => decryptSecretById(stored.id).then((d) => d.notes)} multiline />
            ) : (
              <div className="text-[12.5px] text-subtle py-0.5">No notes</div>
            )}
          </section>

          {/* Shares */}
          <section className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="mono-label">Active shares</div>
              <button className="text-[11px] text-muted hover:text-accent-light transition-colors flex items-center gap-1" onClick={() => setSharing(true)}>
                <FiShare2 size={10} /> new link
              </button>
            </div>
            {secretShares.length === 0 ? (
              <div className="text-xs text-muted">No active shares.</div>
            ) : (
              secretShares.map((sh) => (
                <div key={sh.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                  <span className="text-[12px] flex-1 truncate">expires {formatDate(sh.expiresAt)} · {sh.viewsUsed}/{sh.viewsAllowed ?? '∞'} views</span>
                  <button className="text-[11px] text-muted hover:text-rose-300" onClick={() => void removeShare(sh.id).then(() => pushToast.success('Share revoked'))}>
                    revoke
                  </button>
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      {sharing && (
        <ShareDialog
          secretId={stored.id}
          name={stored.name}
          service={stored.service}
          type={stored.type}
          projectId={stored.projectId}
          onClose={() => setSharing(false)}
          onValue={async () => (await decryptSecretById(stored.id)).value}
        />
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2 min-w-0">
      <div className="mono-label">{label}</div>
      <div className="text-[12.5px] mt-0.5 truncate">{children}</div>
    </div>
  );
}

// ─── Share dialog ───────────────────────────────────────────────────────────

function ShareDialog({ secretId, name, service, type, projectId, onClose, onValue }: {
  secretId: string; name: string; service: string; type: string; projectId: string | null;
  onClose: () => void; onValue: () => Promise<string>;
}) {
  const shareSecret = useDataStore((s) => s.shareSecret);
  const [expiryHours, setExpiryHours] = useState(24);
  const [viewsAllowed, setViewsAllowed] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const value = await onValue();
      const link = await shareSecret({
        secretId,
        secretName: name,
        service,
        type: type as never,
        value,
        expiryHours,
        viewsAllowed: viewsAllowed ? Number(viewsAllowed) : null,
        projectId,
      });
      setUrl(link);
      await copyToSystemClipboard(link, 'Share link copied');
    } catch (e) {
      pushToast.fromError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel card w-full max-w-sm p-5 anim-scale-in" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-sm mb-1">Share "{name}"</h2>
        <p className="text-xs text-muted mb-4 leading-relaxed">
          Creates a zero-knowledge link — the value is re-encrypted with a one-off key held in the URL fragment.
        </p>
        {url ? (
          <div className="space-y-3">
            <AlertBlock tone="accent" icon={<FiShare2 size={13} className="mt-0.5 shrink-0" />}>Link copied to your clipboard.</AlertBlock>
            <div className="font-mono text-[11px] break-all bg-black/40 border border-border rounded-lg p-2.5 selectable">{url}</div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <label className="block">
                <span className="mono-label block mb-1">Expires after</span>
                <select className="field" value={expiryHours} onChange={(e) => setExpiryHours(Number(e.target.value))}>
                  <option value={1}>1 hour</option>
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                </select>
              </label>
              <label className="block">
                <span className="mono-label block mb-1">Max views (blank = unlimited)</span>
                <input className="field" type="number" min={1} value={viewsAllowed} onChange={(e) => setViewsAllowed(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={() => void create()} disabled={busy}>
                {busy ? <><span className="spinner" /> Creating…</> : 'Create link'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
