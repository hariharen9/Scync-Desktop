/** ProjectsView — project grid with per-project secret counts and safe deletion. */
import { useState } from 'react';
import { FiFolder, FiPlus } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { ColorDot, EmptyState, PageHeader, formatDate } from '@/ui/components/common.js';
import { Chip } from '@/ui/components/primitives.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function ProjectsView() {
  const projects = useDataStore((s) => s.projects);
  const secrets = useDataStore((s) => s.secrets);
  const loaded = useDataStore((s) => s.loaded);
  const setView = useUiStore((s) => s.setView);
  const setFilter = useUiStore((s) => s.setFilter);
  const openForm = useUiStore((s) => s.openForm);
  const removeProject = useDataStore((s) => s.removeProject);
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);

  const counts = new Map<string, number>();
  for (const s of secrets) if (s.projectId) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);

  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  const doDelete = (id: string, name: string) => {
    const others = projects.filter((p) => p.id !== id);
    setMoveTo(others[0]?.id ?? '');
    setMoveTarget({ id, name });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        <PageHeader
          title="Projects"
          subtitle={`${sorted.length} project${sorted.length === 1 ? '' : 's'} · group secrets across environments`}
          actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('project')}><FiPlus size={13} /> New</button>}
        />

        {!loaded.projects ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="card h-[118px] skeleton" />)}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<FiFolder size={20} />}
            title="No projects"
            hint="Projects group secrets across environments, exactly like the web app."
            action={<button className="btn-primary !text-[12px]" onClick={() => openForm('project')}><FiPlus size={12} /> Create project</button>}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sorted.map((p, i) => (
              <div key={p.id} className="card p-4 hover:border-border-strong transition-colors anim-fade-up" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                <div className="flex items-center gap-2.5">
                  <ColorDot color={p.color} />
                  <button
                    className="text-[13px] font-semibold flex-1 truncate text-left hover:text-accent-light transition-colors"
                    onClick={() => { setFilter({ projectId: p.name }); setView('secrets'); }}
                    title={`Open secrets in ${p.name}`}
                  >
                    {p.icon && <span className="mr-1.5">{p.icon}</span>}{p.name}
                  </button>
                  <Chip>{counts.get(p.id) ?? 0}</Chip>
                </div>
                {p.description && <p className="text-xs text-muted mt-2 line-clamp-2 leading-relaxed">{p.description}</p>}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <span className="text-[10.5px] text-subtle">updated {formatDate(p.updatedAt)}</span>
                  <div className="flex gap-1">
                    <button className="btn-ghost !px-2 !py-0.5 !text-[11px]" onClick={() => openForm('project', p.id)}>edit</button>
                    <button className="btn-ghost !px-2 !py-0.5 !text-[11px] hover:!text-rose-300 hover:!border-rose-500/40" onClick={() => doDelete(p.id, p.name)}>delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {moveTarget && (
        <div className="modal-overlay" onClick={() => setMoveTarget(null)}>
          <div className="modal-panel card w-full max-w-sm p-5 anim-scale-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-sm mb-1">Delete "{moveTarget.name}"</h2>
            <p className="text-xs text-muted mb-3">
              {counts.get(moveTarget.id) ?? 0} secret(s) belong to this project. Where should they go?
            </p>
            <select className="field mb-4" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">— unassigned —</option>
              {projects.filter((p) => p.id !== moveTarget.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setMoveTarget(null)} disabled={busy}>Cancel</button>
              <button
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  const target = moveTarget;
                  setBusy(true);
                  void removeProject(target.id, moveTo || null)
                    .then((n) => { pushToast.success('Project deleted', `${n} secret(s) reassigned`); setMoveTarget(null); })
                    .catch((e) => pushToast.fromError(e))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? <><span className="spinner" /> Deleting…</> : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
