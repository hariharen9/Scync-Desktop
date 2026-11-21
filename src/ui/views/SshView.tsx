/** SshView — SSH keys with fingerprint, hosts, and reveal-on-click keys. */
import { FiPlus, FiTerminal } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { DetailActions, EmptyState, RevealValue, ViewHeader, formatDate } from '@/ui/components/common.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function SshView() {
  const sshKeys = useDataStore((s) => s.sshKeys);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const selected = sshKeys.find((k) => k.id === selectedId) ?? null;

  const sorted = [...sshKeys].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="h-full flex">
      <div className="w-96 shrink-0 border-r border-border flex flex-col">
        <div className="p-4">
          <ViewHeader
            title="SSH keys"
            subtitle={`${sorted.length} key${sorted.length === 1 ? '' : 's'}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('ssh')}><FiPlus size={13} /></button>}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sorted.length === 0 && <div className="text-center text-muted text-xs mt-10">No keys yet.</div>}
          {sorted.map((k) => (
            <button
              key={k.id}
              onClick={() => selectSecret(k.id)}
              className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 ' + (selectedId === k.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/5')}
            >
              <div className="text-[13px] truncate">{k.name}</div>
              <div className="text-[11px] text-subtle truncate font-mono">{k.type} · {k.hosts.length} host{k.hosts.length === 1 ? '' : 's'}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? <SshDetail id={selected.id} /> : (
          <EmptyState
            icon={<FiTerminal size={20} />}
            title="Select an SSH key"
            hint="Generate a keypair or paste an existing one — the private key is encrypted client-side."
          />
        )}
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
        .then(() => { selectSecret(null); pushToast('Key deleted'); })
        .catch((e) => pushToast('Delete failed', e instanceof Error ? e.message : String(e)));
    },
  });

  return (
    <div className="max-w-xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight truncate">{stored.name}</h1>
          <div className="text-[11px] text-muted mt-1 font-mono">{stored.type}</div>
        </div>
        <DetailActions onEdit={() => openForm('ssh', stored.id)} onDelete={doDelete} />
      </div>

      <DetailRow label="Fingerprint">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] break-all">{stored.fingerprint}</span>
          <button className="btn-ghost !px-2 !py-1" onClick={() => void copyToSystemClipboard(stored.fingerprint, 'Fingerprint copied')}>copy</button>
        </div>
      </DetailRow>
      <DetailRow label="Public key">
        <RevealValue decrypt={() => useDataStore.getState().decryptSshPublic(id)} multiline />
      </DetailRow>
      <DetailRow label="Private key">
        <RevealValue decrypt={() => decryptSshPrivate(id)} multiline />
      </DetailRow>
      <DetailRow label="Hosts">
        {stored.hosts.length > 0 ? <span className="font-mono text-[12px]">{stored.hosts.join(', ')}</span> : '—'}
      </DetailRow>
      <DetailRow label="Rotation due">{formatDate(stored.rotationDate)}</DetailRow>
      <DetailRow label="Added">{formatDate(stored.createdAt)}</DetailRow>
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
