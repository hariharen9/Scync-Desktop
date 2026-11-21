/**
 * SecretsView — filterable, project-grouped list with a detail panel:
 * reveal-on-click value, notes, lifecycle metadata, share + delete.
 */
import { useMemo, useState } from 'react';
import { FiDatabase, FiPlus, FiShare2 } from 'react-icons/fi';
import { useUiStore, type ProjectColor } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getAttentionSecrets } from '@/backend/index.js';
import { ColorDot, DetailActions, EmptyState, EnvPill, SelectFilter, StatusPill, ViewHeader, formatDate, RevealValue } from '@/ui/components/common.js';
import { pushToast } from '@/ui/components/Toast.js';

const ENVIRONMENTS = ['Personal', 'Work', 'Development', 'Staging', 'Production', 'Local', 'Testing', 'CI/CD'];
const STATUSES = ['Active', 'Rotated', 'Expired', 'Revoked'];
const SECRET_TYPES = ['API Key', 'Personal Access Token', 'OAuth Token', 'OAuth Client Secret', 'Recovery Codes', 'Secret Key', 'Webhook Secret', 'Service Account JSON', 'Database URL', 'License Key', 'Passphrase', 'Secret Note', 'Password', 'Other'];

export default function SecretsView() {
  const secrets = useDataStore((s) => s.secrets);
  const projects = useDataStore((s) => s.projects);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const attention = getAttentionSecrets(secrets);
  const flagged = new Set([...attention.expired, ...attention.rotationOverdue, ...attention.recoveryCodesLow].map((s) => s.id));

  const filtered = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    // The project filter select works by name; resolve to the id for comparison.
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
  const selected = filtered.find((s) => s.id === selectedId) ?? null;

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

  return (
    <div className="h-full flex">
      <div className="w-96 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 pb-2">
          <ViewHeader
            title="Secrets"
            subtitle={`${filtered.length} of ${secrets.length}`}
            actions={
              <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('secret')}>
                <span className="inline-flex items-center gap-1.5"><FiPlus size={13} /> New</span>
              </button>
            }
          />
          <input
            className="field mb-2"
            placeholder="Search name or service…"
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5">
            <SelectFilter label="Service" value={filter.service} onChange={(v) => setFilter({ service: v })} options={services} />
            <SelectFilter label="Type" value={filter.type} onChange={(v) => setFilter({ type: v as typeof filter.type })} options={SECRET_TYPES} />
            <SelectFilter label="Env" value={filter.environment} onChange={(v) => setFilter({ environment: v as typeof filter.environment })} options={ENVIRONMENTS} />
            <SelectFilter label="Status" value={filter.status} onChange={(v) => setFilter({ status: v as typeof filter.status })} options={STATUSES} />
            <SelectFilter
              label="Project"
              value={filter.projectId}
              onChange={(v) => setFilter({ projectId: v })}
              options={projects.map((p) => p.name)}
            />
            {(filter.service || filter.type || filter.environment || filter.status || filter.projectId || filter.search) && (
              <button className="text-[11px] text-muted hover:text-text" onClick={clearFilters}>clear</button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {groups.length === 0 && (
            <div className="text-center text-muted text-xs mt-10">No secrets match.</div>
          )}
          {groups.map(({ project, list }) => (
            <div key={project?.id ?? 'none'} className="mb-3">
              <div className="px-2 py-1.5 flex items-center gap-1.5 mono-label">
                {project ? <><ColorDot color={project.color as ProjectColor} /> {project.name}</> : 'No project'}
              </div>
              {list.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSecret(s.id)}
                  className={
                    'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 ' +
                    (selectedId === s.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/5')
                  }
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] truncate flex-1">{s.name}</span>
                    {flagged.has(s.id) && <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" title="Needs attention" />}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <StatusPill status={s.status} />
                    <EnvPill environment={s.environment} />
                    <span className="text-[11px] text-subtle truncate">{s.service}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <SecretDetail id={selected.id} />
        ) : (
          <EmptyState
            icon={<FiDatabase size={20} />}
            title="Select a secret"
            hint="Pick a secret from the list, or create a new one. Values stay encrypted until you reveal them."
          />
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
  const shareSecret = useDataStore((s) => s.shareSecret);

  const [sharing, setSharing] = useState(false);
  const [expiryHours, setExpiryHours] = useState(24);
  const [viewsAllowed, setViewsAllowed] = useState('');

  if (!stored) return <div className="text-muted text-sm">Secret not found.</div>;
  const project = stored.projectId ? projects.find((p) => p.id === stored.projectId) : null;
  const secretShares = shares.filter((sh) => sh.projectId === stored.projectId && sh.encValue && sh.secretName === stored.name);

  const doDelete = () => askConfirm({
    title: 'Delete secret',
    message: `Permanently delete "${stored.name}" (${stored.service})? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeSecret(stored.id, stored.name, stored.service)
        .then(() => { selectSecret(null); pushToast('Secret deleted'); })
        .catch((e) => pushToast('Delete failed', e instanceof Error ? e.message : String(e)));
    },
  });

  const doShare = async () => {
    setSharing(false);
    try {
      const dec = await decryptSecretById(stored.id);
      const url = await shareSecret({
        secretId: stored.id,
        secretName: stored.name,
        service: stored.service,
        type: stored.type,
        value: dec.value,
        expiryHours,
        viewsAllowed: viewsAllowed ? Number(viewsAllowed) : null,
        projectId: stored.projectId,
      });
      await navigator.clipboard.writeText(url);
      pushToast('Share link copied', `${url} — expires in ${expiryHours}h`);
    } catch (e) {
      pushToast('Share failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight truncate">{stored.name}</h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            <StatusPill status={stored.status} />
            <EnvPill environment={stored.environment} />
            <span className="text-[11px] text-muted">{stored.type}</span>
          </div>
        </div>
        <DetailActions
          onEdit={() => openForm('secret', stored.id)}
          onDelete={doDelete}
          extra={<button className="btn-ghost" onClick={() => setSharing(true)} title="Share"><FiShare2 size={13} /></button>}
        />
      </div>

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
      <DetailRow label="Updated">{formatDate(stored.updatedAt)}</DetailRow>

      {stored.type === 'Recovery Codes' && stored.remainingCodes !== null && (
        <DetailRow label="Remaining codes">{stored.remainingCodes}</DetailRow>
      )}

      <div className="card p-4 mt-4">
        <div className="mono-label mb-2">Active shares</div>
        {secretShares.length === 0 ? (
          <div className="text-xs text-muted">No active shares.</div>
        ) : (
          secretShares.map((sh) => (
            <div key={sh.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
              <span className="text-[12px] flex-1 truncate">expires {formatDate(sh.expiresAt)} · {sh.viewsUsed}/{sh.viewsAllowed ?? '∞'} views</span>
              <button className="text-[11px] text-muted hover:text-rose-300" onClick={() => void removeShare(sh.id).then(() => pushToast('Share revoked'))}>
                revoke
              </button>
            </div>
          ))
        )}
      </div>

      {sharing && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setSharing(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-sm mb-1">Share "{stored.name}"</h2>
            <p className="text-xs text-muted mb-4">A zero-knowledge link is created; the value is re-encrypted with a one-off key. Blink shows the copy confirmation.</p>
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
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-ghost" onClick={() => setSharing(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => void doShare()}>Create link</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-border last:border-0">
      <span className="mono-label w-28 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </div>
  );
}
