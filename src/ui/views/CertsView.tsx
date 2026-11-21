/** CertsView — certificates with parsed metadata and expiry tracking. */
import { useState } from 'react';
import { FiPlus, FiShield } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { DetailActions, EmptyState, RevealValue, ViewHeader, formatDate } from '@/ui/components/common.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function CertsView() {
  const certificates = useDataStore((s) => s.certificates);
  const openForm = useUiStore((s) => s.openForm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const selected = certificates.find((c) => c.id === selectedId) ?? null;

  const sorted = [...certificates].sort((a, b) => a.validTo.getTime() - b.validTo.getTime());
  const now = new Date();

  return (
    <div className="h-full flex">
      <div className="w-96 shrink-0 border-r border-border flex flex-col">
        <div className="p-4">
          <ViewHeader
            title="Certificates"
            subtitle={`${sorted.length} certificate${sorted.length === 1 ? '' : 's'}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('cert')}><FiPlus size={13} /></button>}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {sorted.length === 0 && <div className="text-center text-muted text-xs mt-10">No certificates yet.</div>}
          {sorted.map((c) => {
            const expired = c.validTo < now;
            const soon = !expired && c.validTo.getTime() - now.getTime() < 30 * 24 * 3600 * 1000;
            return (
              <button
                key={c.id}
                onClick={() => selectSecret(c.id)}
                className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 ' + (selectedId === c.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/5')}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] truncate flex-1">{c.name}</span>
                  <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (expired ? 'bg-rose-400' : soon ? 'bg-warn' : 'bg-emerald-400')} title={expired ? 'Expired' : soon ? 'Expires within 30 days' : 'Valid'} />
                </div>
                <div className="text-[11px] text-subtle truncate">
                  {expired ? <span className="text-rose-300">expired {formatDate(c.validTo)}</span> : `expires ${formatDate(c.validTo)}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? <CertDetail id={selected.id} /> : (
          <EmptyState icon={<FiShield size={20} />} title="Select a certificate" hint="Paste a PEM to parse its metadata — the PEM and key are encrypted at rest." />
        )}
      </div>
    </div>
  );
}

function CertDetail({ id }: { id: string }) {
  const stored = useDataStore((s) => s.certificates.find((c) => c.id === id));
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptCertById = useDataStore((s) => s.decryptCertById);
  const removeCertificate = useDataStore((s) => s.removeCertificate);
  const [metaOpen, setMetaOpen] = useState(false);
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');

  if (!stored) return <div className="text-muted text-sm">Certificate not found.</div>;

  const doDelete = () => askConfirm({
    title: 'Delete certificate',
    message: `Permanently delete "${stored.name}" (and its private key, if stored)? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeCertificate(stored.id)
        .then(() => { selectSecret(null); pushToast('Certificate deleted'); })
        .catch((e) => pushToast('Delete failed', e instanceof Error ? e.message : String(e)));
    },
  });

  const saveMeta = async () => {
    try {
      await useDataStore.getState().updateCertMeta(stored.id, {
        name: name.trim() || undefined,
        hosts: hosts.split(',').map((h) => h.trim()).filter(Boolean),
      });
      setMetaOpen(false);
      pushToast('Certificate updated');
    } catch (e) {
      pushToast('Update failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-tight truncate">{stored.name}</h1>
          <div className="text-[12px] text-muted mt-1 break-all">{stored.subject}</div>
        </div>
        <DetailActions
          onEdit={() => { setName(stored.name); setHosts(stored.hosts.join(', ')); setMetaOpen(true); }}
          onDelete={doDelete}
        />
      </div>

      <DetailRow label="Issuer">{stored.issuer}</DetailRow>
      <DetailRow label="Serial"><span className="font-mono text-[11px] break-all">{stored.serialNumber}</span></DetailRow>
      <DetailRow label="Fingerprint"><span className="font-mono text-[11px] break-all">{stored.fingerprint}</span></DetailRow>
      <DetailRow label="Valid from">{formatDate(stored.validFrom)}</DetailRow>
      <DetailRow label="Valid to">{formatDate(stored.validTo)}</DetailRow>
      <DetailRow label="Self-signed">{stored.isSelfSigned ? 'yes' : 'no'}</DetailRow>
      <DetailRow label="Hosts">{stored.hosts.length > 0 ? <span className="font-mono text-[12px]">{stored.hosts.join(', ')}</span> : '—'}</DetailRow>

      <div className="card p-4 mt-4">
        <div className="mono-label mb-2">Certificate PEM</div>
        <RevealValue decrypt={() => decryptCertById(id).then((d) => d.certPem)} multiline />
        <div className="mono-label mt-4 mb-2">Private key PEM {stored.encKeyPem ? '' : '(not stored)'}</div>
        {stored.encKeyPem ? <RevealValue decrypt={() => decryptCertById(id).then((d) => d.keyPem ?? '')} multiline /> : <div className="text-xs text-muted">No private key saved for this certificate.</div>}
      </div>

      {metaOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={() => setMetaOpen(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold text-sm mb-4">Edit certificate metadata</h2>
            <div className="space-y-3">
              <label className="block">
                <span className="mono-label block mb-1">Name</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className="mono-label block mb-1">Hosts (comma-separated)</span>
                <input className="field" value={hosts} onChange={(e) => setHosts(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-ghost" onClick={() => setMetaOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => void saveMeta()}>Save</button>
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
      <span className="mono-label w-24 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 flex-1 text-[13px]">{children}</div>
    </div>
  );
}
