/** PasswordsView — username/password entries with reveal-on-click details. */
import { useMemo } from 'react';
import { FiKey, FiPlus } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { DetailActions, EmptyState, RevealValue, SelectFilter, ViewHeader } from '@/ui/components/common.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { formatDate } from '@/ui/components/common.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function PasswordsView() {
  const passwords = useDataStore((s) => s.passwords);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);

  const categories = useMemo(() => [...new Set(passwords.map((p) => p.category))].filter(Boolean).sort(), [passwords]);
  const filtered = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    return passwords
      .filter((p) => {
        if (filter.service && p.category !== filter.service) return false;
        if (q) {
          const hay = `${p.name} ${p.username} ${p.url} ${p.category}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [passwords, filter]);

  const selected = filtered.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="h-full flex">
      <div className="w-96 shrink-0 border-r border-border flex flex-col">
        <div className="p-4 pb-2">
          <ViewHeader
            title="Passwords"
            subtitle={`${filtered.length} of ${passwords.length}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('password')}><FiPlus size={13} /></button>}
          />
          <input className="field mb-2" placeholder="Search…" value={filter.search} onChange={(e) => setFilter({ search: e.target.value })} />
          <div className="flex flex-wrap gap-1.5">
            <SelectFilter label="Category" value={filter.service} onChange={(v) => setFilter({ service: v })} options={categories} />
            {(filter.service || filter.search) && (
              <button className="text-[11px] text-muted hover:text-text" onClick={clearFilters}>clear</button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {filtered.length === 0 && <div className="text-center text-muted text-xs mt-10">No entries match.</div>}
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => selectSecret(p.id)}
              className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 ' + (selectedId === p.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/5')}
            >
              <div className="text-[13px] truncate">{p.name}</div>
              <div className="text-[11px] text-subtle truncate">{p.username || p.category || '—'}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? <PasswordDetail id={selected.id} /> : (
          <EmptyState icon={<FiKey size={20} />} title="Select a password" hint="Pick an entry from the list, or create a new one." />
        )}
      </div>
    </div>
  );
}

function PasswordDetail({ id }: { id: string }) {
  const stored = useDataStore((s) => s.passwords.find((p) => p.id === id));
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptPasswordById = useDataStore((s) => s.decryptPasswordById);
  const removePassword = useDataStore((s) => s.removePassword);

  if (!stored) return <div className="text-muted text-sm">Entry not found.</div>;

  const doDelete = () => askConfirm({
    title: 'Delete password',
    message: `Permanently delete "${stored.name}"? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removePassword(stored.id)
        .then(() => { selectSecret(null); pushToast('Password deleted'); })
        .catch((e) => pushToast('Delete failed', e instanceof Error ? e.message : String(e)));
    },
  });

  return (
    <div className="max-w-xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight truncate">{stored.name}</h1>
          {stored.url && (
            <a className="text-[12px] text-accent-light hover:underline break-all" href={stored.url} target="_blank" rel="noreferrer">
              {stored.url}
            </a>
          )}
        </div>
        <DetailActions onEdit={() => openForm('password', stored.id)} onDelete={doDelete} />
      </div>

      <DetailRow label="Password">
        <RevealValue decrypt={() => decryptPasswordById(id).then((d) => d.password)} />
      </DetailRow>
      <DetailRow label="Username">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] truncate">{stored.username || '—'}</span>
          {stored.username && (
            <button className="btn-ghost !px-2 !py-1" onClick={() => void copyToSystemClipboard(stored.username, 'Username copied')}>
              copy
            </button>
          )}
        </div>
      </DetailRow>
      <DetailRow label="Notes">
        <RevealValue decrypt={() => decryptPasswordById(id).then((d) => d.notes)} multiline />
      </DetailRow>
      <DetailRow label="Category">{stored.category || '—'}</DetailRow>
      <DetailRow label="Updated">{formatDate(stored.updatedAt)}</DetailRow>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-border last:border-0">
      <span className="mono-label w-24 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </div>
  );
}
