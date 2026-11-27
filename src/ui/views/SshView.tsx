/** SshView — SSH keys with fingerprint, hosts, and reveal-on-click keys. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiEdit2, FiTerminal, FiTrash2 } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { AlertBlock, EmptyState, RevealValue, formatDate } from '@/ui/components/common.js';
import { Chip, CopyIconButton, ListSkeleton } from '@/ui/components/primitives.js';
import { DetailBody, DetailHeader, ListHeader, MasterDetail, MetaCell, MetaGrid, SearchField } from '@/ui/components/masterDetail.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';
import type { StoredSSHKey } from '@/backend/index.js';

export default function SshView() {
  const sshKeys = useDataStore((s) => s.sshKeys);
  const loaded = useDataStore((s) => s.loaded);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const [query, setQuery] = useState('');
  const [algoFilter, setAlgoFilter] = useState<'all' | 'ed25519' | 'rsa' | 'hosts'>('all');
  const searchRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sshKeys]
      .filter((k) => {
        if (algoFilter === 'ed25519' && !k.type.toLowerCase().includes('ed25519')) return false;
        if (algoFilter === 'rsa' && !k.type.toLowerCase().includes('rsa')) return false;
        if (algoFilter === 'hosts' && (!k.hosts || k.hosts.length === 0)) return false;
        return !q || `${k.name} ${k.type} ${k.hosts.join(' ')} ${k.fingerprint}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sshKeys, query, algoFilter]);

  const copySshConfig = () => {
    const keysWithHosts = sshKeys.filter((k) => k.hosts && k.hosts.length > 0);
    if (keysWithHosts.length === 0) {
      pushToast('No mapped hosts', 'Add hosts to an SSH key to generate ~/.ssh/config.');
      return;
    }
    let config = '# ── SCYNC SSH CONFIG ─────────────────────────────────\n# Add to ~/.ssh/config (chmod 400 ~/.ssh/*.pem)\n\n';
    for (const key of keysWithHosts) {
      const slug = key.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'key';
      for (const host of key.hosts) {
        config += `Host ${host}\n  HostName ${host}\n  IdentityFile ~/.ssh/${slug}.pem\n  IdentitiesOnly yes\n\n`;
      }
    }
    void copyToSystemClipboard(config, '~/.ssh/config copied');
  };

  const selected = sshKeys.find((k) => k.id === selectedId) ?? null;
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
    <MasterDetail
      hasSelection={Boolean(selected)}
      list={() => (
        <>
          <ListHeader
            title="SSH keys"
            subtitle={`${sorted.length} key${sorted.length === 1 ? '' : 's'}`}
            onNew={() => openForm('ssh')}
          >
            {sshKeys.length > 0 && (
              <div className="space-y-2">
                <SearchField
                  inputRef={searchRef}
                  value={query}
                  onChange={setQuery}
                  placeholder="Filter keys…"
                />
                <div className="flex items-center gap-1 flex-wrap">
                  {(['all', 'ed25519', 'rsa', 'hosts'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setAlgoFilter(tab)}
                      className={
                        'px-2 py-0.5 rounded text-[10.5px] font-mono uppercase transition-colors ' +
                        (algoFilter === tab
                          ? 'bg-accent-dim text-accent-light border border-accent-border'
                          : 'text-muted hover:text-text border border-border')
                      }
                    >
                      {tab}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={copySshConfig}
                    className="ml-auto px-2 py-0.5 rounded text-[10.5px] font-mono border border-border text-muted hover:text-text transition-colors"
                    title="Copy ~/.ssh/config for keys with mapped hosts"
                  >
                    ~/.ssh/config
                  </button>
                </div>
              </div>
            )}
          </ListHeader>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {!loaded.sshKeys ? (
              <ListSkeleton rows={7} />
            ) : sorted.length === 0 ? (
              <div className="text-center px-4 mt-12">
                <p className="text-[12.5px] text-muted">{hasFilter ? 'No keys match.' : 'No SSH keys yet.'}</p>
                {!hasFilter && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('ssh')}>Add key</button>}
              </div>
            ) : (
              sorted.map((k) => <SshRow key={k.id} entry={k} selected={k.id === selectedId} onSelect={() => selectSecret(k.id)} />)
            )}
          </div>
        </>
      )}
      detail={(compact) => selected ? (
        <SshDetail key={selected.id} entry={selected} compact={compact} onBack={() => selectSecret(null)} />
      ) : null}
      empty={loaded.sshKeys ? (
        <EmptyState
          icon={<FiTerminal size={20} />}
          title="Select an SSH key"
          hint="Generate a keypair or paste an existing one — the private key is encrypted client-side."
        />
      ) : null}
    />
  );
}

function SshRow({ entry, selected, onSelect }: { entry: StoredSSHKey; selected: boolean; onSelect: () => void }) {
  const rotationDue = entry.rotationDate !== null && entry.rotationDate.getTime() < Date.now();
  return (
    <button
      id={`ssh-row-${entry.id}`}
      onClick={onSelect}
      className={
        'group w-full text-left rounded-lg border px-2.5 py-1.5 mb-0.5 transition-colors ' +
        (selected ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] font-medium truncate flex-1">{entry.name}</span>
        {rotationDue && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Rotation due" />}
      </div>
      <div className="text-[10.5px] text-subtle truncate mt-0.5 font-mono">
        {entry.type} · {entry.hosts.length} host{entry.hosts.length === 1 ? '' : 's'}
      </div>
    </button>
  );
}

function SshDetail({ entry, compact, onBack }: {
  entry: StoredSSHKey;
  compact: boolean;
  onBack: () => void;
}) {
  const openForm = useUiStore((s) => s.openForm);
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptSshPrivate = useDataStore((s) => s.decryptSshPrivate);
  const removeSshKey = useDataStore((s) => s.removeSshKey);

  const doDelete = () => askConfirm({
    title: 'Delete SSH key',
    message: `Permanently delete "${entry.name}" (including its private key)? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeSshKey(entry.id)
        .then(() => { selectSecret(null); pushToast.success('Key deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const rotationDue = entry.rotationDate !== null && entry.rotationDate.getTime() < Date.now();

  return (
    <>
      <DetailHeader
        title={entry.name}
        onBack={compact ? onBack : undefined}
        badges={
          <>
            <Chip>{entry.type}</Chip>
            {rotationDue && <Chip tone="warn">rotation due</Chip>}
          </>
        }
        actions={
          <>
            <button className="icon-btn" onClick={() => openForm('ssh', entry.id)} title="Edit" aria-label="Edit"><FiEdit2 size={15} /></button>
            <button className="icon-btn icon-btn-danger" onClick={doDelete} title="Delete" aria-label="Delete"><FiTrash2 size={15} /></button>
          </>
        }
      />
      <DetailBody>
        <section className="card p-4 mb-4">
          <div className="mono-label mb-2">Public key</div>
          <RevealValue decrypt={() => useDataStore.getState().decryptSshPublic(entry.id)} multiline />
        </section>

        <section className="card p-4 mb-4">
          <div className="mono-label mb-2">Private key</div>
          <RevealValue decrypt={() => decryptSshPrivate(entry.id)} multiline copyLabel="Private key copied" />
        </section>

        <MetaGrid>
          <MetaCell label="Fingerprint" wrap mono>
            <span className="inline-flex items-center gap-1.5">
              {entry.fingerprint}
              <CopyIconButton size={12} label="Copy fingerprint" onCopy={() => copyToSystemClipboard(entry.fingerprint, 'Fingerprint copied')} />
            </span>
          </MetaCell>
          <MetaCell label="Hosts">
            {entry.hosts.length > 0
              ? <span className="font-mono text-[11.5px] truncate">{entry.hosts.join(', ')}</span>
              : <span className="text-subtle">—</span>}
          </MetaCell>
          <MetaCell label="Rotation due">
            {rotationDue
              ? <AlertBlock tone="warn" icon={<span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-current shrink-0" />}>Due {formatDate(entry.rotationDate)}</AlertBlock>
              : (entry.rotationDate ? formatDate(entry.rotationDate) : <span className="text-subtle">—</span>)}
          </MetaCell>
          <MetaCell label="Added">{formatDate(entry.createdAt)}</MetaCell>
        </MetaGrid>
      </DetailBody>
    </>
  );
}
