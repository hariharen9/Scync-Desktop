/**
 * PasswordsView — username/password entries with reveal-on-click details.
 * Desktop master–detail that collapses to a single pane when narrow.
 */
import { useEffect, useMemo, useRef } from 'react';
import { FiEdit2, FiExternalLink, FiKey, FiTrash2 } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { EmptyState, RevealValue, formatDate } from '@/ui/components/common.js';
import { CopyIconButton, ListSkeleton } from '@/ui/components/primitives.js';
import { DetailBody, DetailHeader, ListHeader, MasterDetail, MetaCell, MetaGrid, SearchField } from '@/ui/components/masterDetail.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';
import { openExternal } from '@/auth/bridge.js';
import type { StoredPassword } from '@/backend/index.js';

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

  const categories = useMemo(
    () => [...new Set(passwords.map((p) => p.category))].filter(Boolean).sort(),
    [passwords],
  );
  const filtered = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    return passwords
      .filter((p) => {
        if (filter.service && p.category !== filter.service) return false;
        if (q && !`${p.name} ${p.username} ${p.url} ${p.category}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [passwords, filter]);

  const selected = passwords.find((p) => p.id === selectedId) ?? null;
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
    <MasterDetail
      hasSelection={Boolean(selected)}
      list={() => (
        <>
          <ListHeader
            title="Passwords"
            subtitle={
              <>
                {filtered.length} of {passwords.length}
                {filter.service && <span className="text-accent-light"> · {filter.service}</span>}
              </>
            }
            onNew={() => openForm('password')}
          >
            <div className="mb-2">
              <SearchField
                inputRef={searchRef}
                value={filter.search}
                onChange={(v) => setFilter({ search: v })}
                placeholder="Search login, url, category…"
              />
            </div>
            {categories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-0.5">
                <button
                  onClick={() => setFilter({ service: '' })}
                  className={'shrink-0 rounded-md border px-2 py-1 text-[11.5px] transition-colors ' + (!filter.service ? 'border-accent-border bg-accent-dim text-accent-light' : 'border-border bg-white/[0.03] text-muted hover:text-text hover:border-border-strong')}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilter({ service: filter.service === c ? '' : c })}
                    className={'shrink-0 rounded-md border px-2 py-1 text-[11.5px] transition-colors ' + (filter.service === c ? 'border-accent-border bg-accent-dim text-accent-light' : 'border-border bg-white/[0.03] text-muted hover:text-text hover:border-border-strong')}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </ListHeader>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {!loaded.passwords ? (
              <ListSkeleton rows={9} />
            ) : filtered.length === 0 ? (
              <div className="text-center px-4 mt-12">
                <p className="text-[12.5px] text-muted">{hasFilters ? 'No entries match.' : 'No passwords yet.'}</p>
                {hasFilters
                  ? <button className="text-[11.5px] text-accent-light hover:underline mt-2" onClick={clearFilters}>Clear filters</button>
                  : <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('password')}>Add password</button>}
              </div>
            ) : (
              filtered.map((p) => (
                <PasswordRow key={p.id} entry={p} selected={p.id === selectedId} onSelect={() => selectSecret(p.id)} />
              ))
            )}
          </div>
        </>
      )}
      detail={(compact) => selected ? (
        <PasswordDetail key={selected.id} entry={selected} compact={compact} onBack={() => selectSecret(null)} />
      ) : null}
      empty={loaded.passwords ? (
        <EmptyState icon={<FiKey size={20} />} title="Select a password" hint="Pick an entry from the list, or create a new one. Passwords stay encrypted until you reveal them." />
      ) : null}
    />
  );
}

function PasswordRow({ entry, selected, onSelect }: { entry: StoredPassword; selected: boolean; onSelect: () => void }) {
  const host = entry.url ? entry.url.replace(/^https?:\/\//i, '').replace(/\/$/, '') : '';
  return (
    <button
      id={`pw-row-${entry.id}`}
      onClick={onSelect}
      className={
        'group w-full text-left rounded-lg border px-2.5 py-1.5 mb-0.5 transition-colors ' +
        (selected ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] font-medium truncate flex-1">{entry.name}</span>
        {entry.category && (
          <span className="text-[10px] text-subtle shrink-0 truncate max-w-[40%]">{entry.category}</span>
        )}
      </div>
      <div className="text-[10.5px] text-subtle truncate mt-0.5">
        {entry.username || host || '—'}
      </div>
    </button>
  );
}

function PasswordDetail({ entry, compact, onBack }: {
  entry: StoredPassword;
  compact: boolean;
  onBack: () => void;
}) {
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptPasswordById = useDataStore((s) => s.decryptPasswordById);
  const removePassword = useDataStore((s) => s.removePassword);

  const doDelete = () => askConfirm({
    title: 'Delete password',
    message: `Permanently delete "${entry.name}"? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removePassword(entry.id)
        .then(() => { selectSecret(null); pushToast.success('Password deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const urlHref = entry.url && !/^https?:\/\//i.test(entry.url) ? `https://${entry.url}` : entry.url;

  return (
    <>
      <DetailHeader
        title={entry.name}
        onBack={compact ? onBack : undefined}
        subtitle={entry.url ? (
          <button
            className="text-[12px] text-accent-light hover:underline break-all text-left inline-flex items-center gap-1"
            onClick={() => openExternal(urlHref)}
          >
            {entry.url} <FiExternalLink size={11} className="shrink-0" />
          </button>
        ) : undefined}
        actions={
          <>
            <button className="icon-btn" onClick={() => openForm('password', entry.id)} title="Edit" aria-label="Edit"><FiEdit2 size={15} /></button>
            <button className="icon-btn icon-btn-danger" onClick={doDelete} title="Delete" aria-label="Delete"><FiTrash2 size={15} /></button>
          </>
        }
      />
      <DetailBody>
        <section className="card p-4 mb-4">
          <div className="mono-label mb-2">Password</div>
          <RevealValue decrypt={() => decryptPasswordById(entry.id).then((d) => d.password)} />
        </section>

        <MetaGrid>
          <MetaCell label="Username">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[12px] truncate">{entry.username || <span className="text-subtle">—</span>}</span>
              {entry.username && (
                <CopyIconButton size={12} label="Copy username" onCopy={() => copyToSystemClipboard(entry.username, 'Username copied')} />
              )}
            </div>
          </MetaCell>
          <MetaCell label="Category">{entry.category || <span className="text-subtle">—</span>}</MetaCell>
          <MetaCell label="Updated">{formatDate(entry.updatedAt)}</MetaCell>
        </MetaGrid>

        <section className="card p-4 mt-4">
          <div className="mono-label mb-2">Notes</div>
          {entry.encNotes
            ? <RevealValue decrypt={() => decryptPasswordById(entry.id).then((d) => d.notes)} multiline />
            : <div className="text-[12.5px] text-subtle">No notes</div>}
        </section>
      </DetailBody>
    </>
  );
}
