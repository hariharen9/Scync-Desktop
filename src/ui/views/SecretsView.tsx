/**
 * SecretsView — filterable, project-grouped list with a detail panel:
 * reveal-on-click value, notes, lifecycle metadata, share + delete.
 * Keyboard: ↑/↓ move selection, / focuses search, Esc clears.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiDatabase, FiPlus, FiSearch, FiShare2, FiX } from 'react-icons/fi';
import { useUiStore, type ProjectColor } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getAttentionSecrets } from '@/backend/index.js';
import {
  AlertBlock, ColorDot, DetailActions, DetailRow, EmptyState, EnvPill, PageHeader,
  SelectFilter, StatusPill, formatDate, RevealValue,
} from '@/ui/components/common.js';
import { Chip, ListSkeleton, Skeleton } from '@/ui/components/primitives.js';
import { pushToast } from '@/ui/components/Toast.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';

const ENVIRONMENTS = ['Personal', 'Work', 'Development', 'Staging', 'Production', 'Local', 'Testing', 'CI/CD'];
const STATUSES = ['Active', 'Rotated', 'Expired', 'Revoked'];
const SECRET_TYPES = ['API Key', 'Personal Access Token', 'OAuth Token', 'OAuth Client Secret', 'Recovery Codes', 'Secret Key', 'Webhook Secret', 'Service Account JSON', 'Database URL', 'License Key', 'Passphrase', 'Secret Note', 'Password', 'Other'];

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
  const attention = getAttentionSecrets(secrets);
  const flagged = new Set([...attention.expired, ...attention.expiringSoon, ...attention.rotationOverdue, ...attention.recoveryCodesLow].map((s) => s.id));

  const filtered = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    const filterProject = filter.projectId ? projects.find((p) => p.name === filter.projectId) : null;
    return secrets.filter((s) => {
      if (filter.service && s.service !== filter.service) return false;
      if (filter.type && s.type !== filter.type) return false;
      if (filter.environment && s.environment !== filter.environment) return false;
      if (filter.status && s.status !== filter.status) return false;
      if (filter.projectId && s.projectId !== (filterProject?.id ?? filter.projectId)) return false;
      if (q && !(s.name.toLowerCase().includes(q) || s.service.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [secrets, filter, projects]);

  const services = useMemo(() => [...new Set(secrets.map((s) => s.service))].sort(), [secrets]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
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
  const selected = ordered.find((s) => s.id === selectedId) ?? null;
  const hasFilters = Boolean(filter.service || filter.type || filter.environment || filter.status || filter.projectId || filter.search);

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

  return (
    <div className="h-full flex">
      {/* List column */}
      <div className="w-[340px] shrink-0 border-r border-border flex flex-col">
        <div className="p-4 pb-2">
          <PageHeader
            title="Secrets"
            subtitle={`${filtered.length} of ${secrets.length}`}
            actions={
              <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('secret')}>
                <FiPlus size={13} /> New
              </button>
            }
          />
          <div className="relative mb-2">
            <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
            <input
              ref={searchRef}
              className="field pl-9 pr-9"
              placeholder="Search name or service…"
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
          <div className="flex flex-wrap gap-1.5">
            <SelectFilter label="Service" value={filter.service} onChange={(v) => setFilter({ service: v })} options={services} />
            <SelectFilter label="Type" value={filter.type} onChange={(v) => setFilter({ type: v as typeof filter.type })} options={SECRET_TYPES} />
            <SelectFilter label="Env" value={filter.environment} onChange={(v) => setFilter({ environment: v as typeof filter.environment })} options={ENVIRONMENTS} />
            <SelectFilter label="Status" value={filter.status} onChange={(v) => setFilter({ status: v as typeof filter.status })} options={STATUSES} />
            <SelectFilter label="Project" value={filter.projectId} onChange={(v) => setFilter({ projectId: v })} options={projects.map((p) => p.name)} />
            {hasFilters && (
              <button className="text-[11px] text-muted hover:text-text px-1.5 self-center" onClick={clearFilters}>clear</button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {!loaded.secrets ? (
            <ListSkeleton rows={8} />
          ) : groups.length === 0 ? (
            <div className="text-center px-4 mt-10">
              <p className="text-[12.5px] text-muted">{hasFilters ? 'No secrets match these filters.' : 'No secrets yet.'}</p>
              {!hasFilters && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('secret')}><FiPlus size={12} /> Add secret</button>}
            </div>
          ) : (
            groups.map(({ project, list }) => (
              <div key={project?.id ?? 'none'} className="mb-3">
                <div className="px-2 py-1.5 flex items-center gap-1.5 mono-label">
                  {project ? <><ColorDot color={project.color as ProjectColor} /> {project.name}</> : 'Uncategorized'}
                  <span className="text-subtle/70">· {list.length}</span>
                </div>
                {list.map((s) => (
                  <button
                    key={s.id}
                    id={`secret-row-${s.id}`}
                    onClick={() => selectSecret(s.id)}
                    className={
                      'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 transition-colors ' +
                      (selectedId === s.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] truncate flex-1">{s.name}</span>
                      {flagged.has(s.id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Needs attention" />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <StatusPill status={s.status} />
                      <EnvPill environment={s.environment} />
                      <span className="text-[11px] text-subtle truncate">{s.service}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <SecretDetail key={selected.id} id={selected.id} />
        ) : loaded.secrets ? (
          <EmptyState
            icon={<FiDatabase size={20} />}
            title="Select a secret"
            hint="Pick a secret from the list, or create a new one. Values stay encrypted until you reveal them."
            action={<button className="btn-ghost !text-[12px]" onClick={() => openForm('secret')}><FiPlus size={12} /> New secret</button>}
          />
        ) : (
          <div className="max-w-xl space-y-4 pt-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        )}
      </div>
    </div>
  );
}

function SecretDetail({ id }: { id: string }) {
  const stored = useDataStore((s) => s.secrets.find((x) => x.id === id));
  const projects = useDataStore((s) => s.projects);
  const shares = useDataStore((s) => s.shares);
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptSecretById = useDataStore((s) => s.decryptSecretById);
  const removeSecret = useDataStore((s) => s.removeSecret);
  const removeShare = useDataStore((s) => s.removeShare);
  const [sharing, setSharing] = useState(false);

  if (!stored) return <div className="text-muted text-sm">Secret not found.</div>;
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
    <div className="max-w-xl anim-fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[19px] font-bold tracking-tight truncate">{stored.name}</h1>
            {expired && <Chip tone="danger">expired</Chip>}
            {expiringSoon && <Chip tone="warn">expiring</Chip>}
            {lowCodes && <Chip tone="danger">low codes</Chip>}
          </div>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <StatusPill status={stored.status} />
            <EnvPill environment={stored.environment} />
            <span className="text-[11px] text-muted">{stored.type}</span>
          </div>
        </div>
        <DetailActions
          onEdit={() => openForm('secret', stored.id)}
          onDelete={doDelete}
          extra={<button className="btn-ghost !px-2.5" onClick={() => setSharing(true)} title="Share"><FiShare2 size={13} /></button>}
        />
      </div>

      {(expired || expiringSoon || lowCodes) && (
        <div className="mb-4">
          <AlertBlock
            tone={expired || lowCodes ? 'danger' : 'warn'}
            icon={<span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
          >
            {expired
              ? `This secret expired on ${formatDate(stored.expiresOn)}. Rotate it and update the entry.`
              : expiringSoon
                ? `This secret expires on ${formatDate(stored.expiresOn)}. Plan a rotation.`
                : `Only ${stored.remainingCodes} recovery code(s) remain. Regenerate the set.`}
          </AlertBlock>
        </div>
      )}

      <div className="card p-4 mb-4">
        <div className="mono-label mb-2">Value — {stored.service}</div>
        <RevealValue decrypt={() => decryptSecretById(stored.id).then((d) => d.value)} />
      </div>

      <DetailRow label="Notes">
        <RevealValue decrypt={() => decryptSecretById(stored.id).then((d) => d.notes)} multiline />
      </DetailRow>
      <DetailRow label="Project">{project ? <span className="inline-flex items-center gap-1.5 text-[13px]"><ColorDot color={project.color as ProjectColor} /> {project.name}</span> : '—'}</DetailRow>
      <DetailRow label="Last rotated">{formatDate(stored.lastRotated)}</DetailRow>
      <DetailRow label="Expires">{formatDate(stored.expiresOn)}</DetailRow>
      {stored.type === 'Recovery Codes' && stored.remainingCodes !== null && (
        <DetailRow label="Remaining codes">{stored.remainingCodes}</DetailRow>
      )}
      <DetailRow label="Updated">{formatDate(stored.updatedAt)}</DetailRow>

      <div className="card p-4 mt-4">
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
