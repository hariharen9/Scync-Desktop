/** ProjectsView — project grid with per-project secret counts and deletion flow. */
import { useState } from 'react';
import { FiFolder, FiPlus } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { ColorDot, EmptyState, ViewHeader, formatDate } from '@/ui/components/common.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function ProjectsView() {
  const projects = useDataStore((s) => s.projects);
  const secrets = useDataStore((s) => s.secrets);
  const openForm = useUiStore((s) => s.openForm);
  const removeProject = useDataStore((s) => s.removeProject);
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const counts = new Map<string, number>();
  for (const s of secrets) if (s.projectId) counts.set(s.projectId, (counts.get(s.projectId) ?? 0) + 1);

  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  const doDelete = (id: string, name: string) => {
    const others = projects.filter((p) => p.id !== id);
    setMoveTo(others[0]?.id ?? '');
    setMoveTarget({ id, name });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <ViewHeader
        title="Projects"
        subtitle={`${sorted.length} project${sorted.length === 1 ? '' : 's'}`}
        actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('project')}><FiPlus size={13} /></button>}
      />

      {sorted.length === 0 ? (
        <EmptyState icon={<FiFolder size={20} />} title="No projects" hint="Projects group secrets across environments, exactly like the web app." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 max-w-4xl">
          {sorted.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-center gap-2.5">
                <ColorDot color={p.color} />
                <span className="text-[13px] font-semibold flex-1 truncate">
                  {p.icon && <span className="mr-1.5">{p.icon}</span>}{p.name}
                </span>
                <span className="mono-label">{counts.get(p.id) ?? 0}</span>
              </div>
              {p.description && <p className="text-xs text-muted mt-2 line-clamp-2">{p.description}</p>}
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-subtle">updated {formatDate(p.updatedAt)}</span>
                <div className="flex gap-1">
                  <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => openForm('project', p.id)}>edit</button>
                  <button className="btn-ghost !px-2 !py-1 text-[11px] hover:!text-rose-300" onClick={() => doDelete(p.id, p.name)}>delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {moveTarget && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setMoveTarget(null)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-sm mb-1">Delete "{moveTarget.name}"</h2>
            <p className="text-xs text-muted mb-3">Where should its {counts.get(moveTarget.id) ?? 0} secret(s) go?</p>
            <select className="field mb-4" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">— unassigned —</option>
              {projects.filter((p) => p.id !== moveTarget.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setMoveTarget(null)}>Cancel</button>
              <button
                className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold bg-red-600 hover:bg-red-500 text-white"
                onClick={() => {
                  const target = moveTarget;
                  setMoveTarget(null);
                  void removeProject(target.id, moveTo || null)
                    .then((n) => pushToast('Project deleted', `${n} secret(s) reassigned`))
                    .catch((e) => pushToast('Delete failed', e instanceof Error ? e.message : String(e)));
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
