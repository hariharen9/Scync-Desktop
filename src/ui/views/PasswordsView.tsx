/** PasswordsView — username/password entries with reveal-on-click details. */
import { useEffect, useMemo, useRef } from 'react';
import { FiKey, FiPlus, FiSearch, FiX } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import {
  DetailActions, DetailRow, EmptyState, PageHeader, RevealValue, SelectFilter, formatDate,
} from '@/ui/components/common.js';
import { ListSkeleton } from '@/ui/components/primitives.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';
import { openExternal } from '@/auth/bridge.js';

export default function PasswordsView() {
  const passwords = useDataStore((s) => s.passwords);
  const loaded = useDataStore((s) => s.loaded);
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const searchRef = useRef<HTMLInputElement>(null);

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
  const hasFilters = Boolean(filter.search || filter.service);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filtered.length > 0) {
        e.preventDefault();
        const idx = filtered.findIndex((p) => p.id === selectedId);
        const next = e.key === 'ArrowDown' ? Math.min(filtered.length - 1, idx < 0 ? 0 : idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
        const t = filtered[next];
        if (t) { selectSecret(t.id); document.getElementById(`pw-row-${t.id}`)?.scrollIntoView({ block: 'nearest' }); }
      }
      if (e.key === 'Escape' && selectedId) selectSecret(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedId, selectSecret]);

  return (
    <div className="h-full flex">
      <div className="w-[340px] shrink-0 border-r border-border flex flex-col">
        <div className="p-4 pb-2">
          <PageHeader
            title="Passwords"
            subtitle={`${filtered.length} of ${passwords.length}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('password')}><FiPlus size={13} /> New</button>}
          />
          <div className="relative mb-2">
            <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
            <input
              ref={searchRef}
              className="field pl-9 pr-9"
              placeholder="Search login, url, category…"
              value={filter.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Escape') { setFilter({ search: '' }); e.currentTarget.blur(); } }}
            />
            {filter.search ? (
              <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text" onClick={() => setFilter({ search: '' })} aria-label="Clear search"><FiX size={13} /></button>
            ) : (
              <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <SelectFilter label="Category" value={filter.service} onChange={(v) => setFilter({ service: v })} options={categories} />
            {hasFilters && <button className="text-[11px] text-muted hover:text-text px-1.5 self-center" onClick={clearFilters}>clear</button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {!loaded.passwords ? (
            <ListSkeleton rows={7} />
          ) : filtered.length === 0 ? (
            <div className="text-center px-4 mt-10">
              <p className="text-[12.5px] text-muted">{hasFilters ? 'No entries match.' : 'No passwords yet.'}</p>
              {!hasFilters && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('password')}><FiPlus size={12} /> Add password</button>}
            </div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                id={`pw-row-${p.id}`}
                onClick={() => selectSecret(p.id)}
                className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 transition-colors ' + (selectedId === p.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')}
              >
                <div className="text-[13px] truncate">{p.name}</div>
                <div className="text-[11px] text-subtle truncate">{p.username || p.category || '—'}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <PasswordDetail key={selected.id} id={selected.id} />
        ) : loaded.passwords ? (
          <EmptyState icon={<FiKey size={20} />} title="Select a password" hint="Pick an entry from the list, or create a new one." />
        ) : null}
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
        .then(() => { selectSecret(null); pushToast.success('Password deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const urlHref = stored.url && !/^https?:\/\//i.test(stored.url) ? `https://${stored.url}` : stored.url;

  return (
    <div className="max-w-xl anim-fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-bold tracking-tight truncate">{stored.name}</h1>
          {stored.url && (
            <button
              className="text-[12px] text-accent-light hover:underline break-all text-left mt-1 inline-flex items-center gap-1"
              onClick={() => openExternal(urlHref)}
            >
              {stored.url}
            </button>
          )}
        </div>
        <DetailActions onEdit={() => openForm('password', stored.id)} onDelete={doDelete} />
      </div>

      <div className="card p-4 mb-4">
        <div className="mono-label mb-2">Password</div>
        <RevealValue decrypt={() => decryptPasswordById(id).then((d) => d.password)} />
      </div>

      <DetailRow label="Username">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] truncate">{stored.username || '—'}</span>
          {stored.username && (
            <button className="btn-ghost !px-2 !py-0.5 !text-[11px]" onClick={() => void copyToSystemClipboard(stored.username, 'Username copied')}>
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
