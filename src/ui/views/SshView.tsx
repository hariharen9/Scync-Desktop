/** SshView — SSH keys with fingerprint, hosts, and reveal-on-click keys. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiSearch, FiTerminal, FiX } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { DetailActions, DetailRow, EmptyState, PageHeader, RevealValue, formatDate } from '@/ui/components/common.js';
import { Chip, CopyIconButton, ListSkeleton } from '@/ui/components/primitives.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function SshView() {
  const sshKeys = useDataStore((s) => s.sshKeys);
  const loaded = useDataStore((s) => s.loaded);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sshKeys]
      .filter((k) => !q || `${k.name} ${k.type} ${k.hosts.join(' ')} ${k.fingerprint}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sshKeys, query]);

  const selected = sorted.find((k) => k.id === selectedId) ?? null;
  const hasFilter = query.trim() !== '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (tag === 'input' || tag === 'textarea') return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sorted.length > 0) {
        e.preventDefault();
        const idx = sorted.findIndex((k) => k.id === selectedId);
        const next = e.key === 'ArrowDown' ? Math.min(sorted.length - 1, idx < 0 ? 0 : idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
        const t = sorted[next];
        if (t) { selectSecret(t.id); document.getElementById(`ssh-row-${t.id}`)?.scrollIntoView({ block: 'nearest' }); }
      }
      if (e.key === 'Escape' && selectedId) selectSecret(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sorted, selectedId, selectSecret]);

  return (
    <div className="h-full flex">
      <div className="w-[340px] shrink-0 border-r border-border flex flex-col">
        <div className="p-4 pb-2">
          <PageHeader
            title="SSH keys"
            subtitle={`${sorted.length} key${sorted.length === 1 ? '' : 's'}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('ssh')}><FiPlus size={13} /> New</button>}
          />
          {sshKeys.length > 0 && (
            <div className="relative">
              <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
              <input
                ref={searchRef}
                className="field pl-9 pr-9"
                placeholder="Filter keys…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
              />
              {query ? (
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-text" onClick={() => setQuery('')} aria-label="Clear"><FiX size={13} /></button>
              ) : (
                <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {!loaded.sshKeys ? (
            <ListSkeleton rows={6} />
          ) : sorted.length === 0 ? (
            <div className="text-center px-4 mt-10">
              <p className="text-[12.5px] text-muted">{hasFilter ? 'No keys match.' : 'No SSH keys yet.'}</p>
              {!hasFilter && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('ssh')}><FiPlus size={12} /> Add key</button>}
            </div>
          ) : (
            sorted.map((k) => (
              <button
                key={k.id}
                id={`ssh-row-${k.id}`}
                onClick={() => selectSecret(k.id)}
                className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 transition-colors ' + (selectedId === k.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')}
              >
                <div className="text-[13px] truncate">{k.name}</div>
                <div className="text-[11px] text-subtle truncate font-mono">{k.type} · {k.hosts.length} host{k.hosts.length === 1 ? '' : 's'}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <SshDetail key={selected.id} id={selected.id} />
        ) : loaded.sshKeys ? (
          <EmptyState
            icon={<FiTerminal size={20} />}
            title="Select an SSH key"
            hint="Generate a keypair or paste an existing one — the private key is encrypted client-side."
          />
        ) : null}
      </div>
    </div>
  );
}

function SshDetail({ id }: { id: string }) {
  const stored = useDataStore((s) => s.sshKeys.find((k) => k.id === id));
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptSshPrivate = useDataStore((s) => s.decryptSshPrivate);
  const removeSshKey = useDataStore((s) => s.removeSshKey);

  if (!stored) return <div className="text-muted text-sm">Key not found.</div>;

  const doDelete = () => askConfirm({
    title: 'Delete SSH key',
    message: `Permanently delete "${stored.name}" (including its private key)? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeSshKey(stored.id)
        .then(() => { selectSecret(null); pushToast.success('Key deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const rotationDue = stored.rotationDate !== null && stored.rotationDate.getTime() < Date.now();

  return (
    <div className="max-w-xl anim-fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-bold tracking-tight truncate">{stored.name}</h1>
          <div className="flex items-center gap-1.5 mt-2">
            <Chip>{stored.type}</Chip>
            {rotationDue && <Chip tone="warn">rotation due</Chip>}
          </div>
        </div>
        <DetailActions onEdit={() => openForm('ssh', stored.id)} onDelete={doDelete} />
      </div>

      <div className="card p-4 mb-4">
        <div className="mono-label mb-2">Public key</div>
        <RevealValue decrypt={() => useDataStore.getState().decryptSshPublic(id)} multiline />
      </div>

      <DetailRow label="Fingerprint">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] break-all">{stored.fingerprint}</span>
          <CopyIconButton size={12} label="Copy fingerprint" onCopy={() => copyToSystemClipboard(stored.fingerprint, 'Fingerprint copied')} />
        </div>
      </DetailRow>
      <DetailRow label="Private key">
        <RevealValue decrypt={() => decryptSshPrivate(id)} multiline copyLabel="Private key copied" />
      </DetailRow>
      <DetailRow label="Hosts">
        {stored.hosts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {stored.hosts.map((h) => <Chip key={h}>{h}</Chip>)}
          </div>
        ) : '—'}
      </DetailRow>
      <DetailRow label="Rotation due">{formatDate(stored.rotationDate)}</DetailRow>
      <DetailRow label="Added">{formatDate(stored.createdAt)}</DetailRow>
    </div>
  );
}
