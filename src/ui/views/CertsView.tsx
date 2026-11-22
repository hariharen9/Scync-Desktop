/** CertsView — certificates with parsed metadata and expiry tracking. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiPlus, FiSearch, FiShield, FiX } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { AlertBlock, DetailActions, DetailRow, EmptyState, PageHeader, RevealValue, formatDate } from '@/ui/components/common.js';
import { Chip, CopyIconButton, ListSkeleton } from '@/ui/components/primitives.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';

export default function CertsView() {
  const certificates = useDataStore((s) => s.certificates);
  const loaded = useDataStore((s) => s.loaded);
  const openForm = useUiStore((s) => s.openForm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const selectedId = useUiStore((s) => s.selectedSecretId);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...certificates]
      .filter((c) => !q || `${c.name} ${c.subject} ${c.issuer} ${c.hosts.join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => a.validTo.getTime() - b.validTo.getTime());
  }, [certificates, query]);

  const selected = sorted.find((c) => c.id === selectedId) ?? null;
  const now = new Date();
  const hasFilter = query.trim() !== '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (tag === 'input' || tag === 'textarea') return;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && sorted.length > 0) {
        e.preventDefault();
        const idx = sorted.findIndex((c) => c.id === selectedId);
        const next = e.key === 'ArrowDown' ? Math.min(sorted.length - 1, idx < 0 ? 0 : idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
        const t = sorted[next];
        if (t) { selectSecret(t.id); document.getElementById(`cert-row-${t.id}`)?.scrollIntoView({ block: 'nearest' }); }
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
            title="Certificates"
            subtitle={`${sorted.length} certificate${sorted.length === 1 ? '' : 's'}`}
            actions={<button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('cert')}><FiPlus size={13} /> New</button>}
          />
          {certificates.length > 0 && (
            <div className="relative">
              <FiSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
              <input
                ref={searchRef}
                className="field pl-9 pr-9"
                placeholder="Filter certificates…"
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
          {!loaded.certificates ? (
            <ListSkeleton rows={6} />
          ) : sorted.length === 0 ? (
            <div className="text-center px-4 mt-10">
              <p className="text-[12.5px] text-muted">{hasFilter ? 'No certificates match.' : 'No certificates yet.'}</p>
              {!hasFilter && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('cert')}><FiPlus size={12} /> Add certificate</button>}
            </div>
          ) : (
            sorted.map((c) => {
              const expired = c.validTo < now;
              const soon = !expired && c.validTo.getTime() - now.getTime() < 30 * 24 * 3600 * 1000;
              return (
                <button
                  key={c.id}
                  id={`cert-row-${c.id}`}
                  onClick={() => selectSecret(c.id)}
                  className={'w-full text-left px-2.5 py-2 rounded-lg border mb-0.5 transition-colors ' + (selectedId === c.id ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] truncate flex-1">{c.name}</span>
                    <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (expired ? 'bg-rose-400' : soon ? 'bg-amber-400' : 'bg-emerald-400')} title={expired ? 'Expired' : soon ? 'Expires within 30 days' : 'Valid'} />
                  </div>
                  <div className="text-[11px] text-subtle truncate">
                    {expired ? <span className="text-rose-300">expired {formatDate(c.validTo)}</span> : `expires ${formatDate(c.validTo)}`}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <CertDetail key={selected.id} id={selected.id} />
        ) : loaded.certificates ? (
          <EmptyState icon={<FiShield size={20} />} title="Select a certificate" hint="Paste a PEM to parse its metadata — the PEM and key are encrypted at rest." />
        ) : null}
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

  const now = Date.now();
  const expired = stored.validTo.getTime() < now;
  const soon = !expired && stored.validTo.getTime() - now < 30 * 24 * 3600 * 1000;

  const doDelete = () => askConfirm({
    title: 'Delete certificate',
    message: `Permanently delete "${stored.name}" (and its private key, if stored)? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeCertificate(stored.id)
        .then(() => { selectSecret(null); pushToast.success('Certificate deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const saveMeta = async () => {
    try {
      await useDataStore.getState().updateCertMeta(stored.id, {
        name: name.trim() || undefined,
        hosts: hosts.split(',').map((h) => h.trim()).filter(Boolean),
      });
      setMetaOpen(false);
      pushToast.success('Certificate updated');
    } catch (e) {
      pushToast.fromError(e);
    }
  };

  return (
    <div className="max-w-xl anim-fade-up">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[19px] font-bold tracking-tight truncate">{stored.name}</h1>
            {expired && <Chip tone="danger">expired</Chip>}
            {soon && <Chip tone="warn">expiring</Chip>}
          </div>
          <div className="text-[12px] text-muted mt-1 break-all">{stored.subject}</div>
        </div>
        <DetailActions
          onEdit={() => { setName(stored.name); setHosts(stored.hosts.join(', ')); setMetaOpen(true); }}
          onDelete={doDelete}
        />
      </div>

      {(expired || soon) && (
        <div className="mb-4">
          <AlertBlock tone={expired ? 'danger' : 'warn'} icon={<span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-current shrink-0" />}>
            {expired ? `This certificate expired on ${formatDate(stored.validTo)}.` : `This certificate expires on ${formatDate(stored.validTo)}.`}
          </AlertBlock>
        </div>
      )}

      <div className="card px-4 py-1 mb-4">
        <DetailRow label="Issuer">{stored.issuer}</DetailRow>
        <DetailRow label="Serial"><span className="font-mono text-[11px] break-all">{stored.serialNumber}</span></DetailRow>
        <DetailRow label="Fingerprint">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] break-all">{stored.fingerprint}</span>
            <CopyIconButton size={12} label="Copy fingerprint" onCopy={() => copyToSystemClipboard(stored.fingerprint, 'Fingerprint copied')} />
          </div>
        </DetailRow>
        <DetailRow label="Valid">{formatDate(stored.validFrom)} → {formatDate(stored.validTo)}</DetailRow>
        <DetailRow label="Self-signed">{stored.isSelfSigned ? 'yes' : 'no'}</DetailRow>
        <DetailRow label="Hosts">
          {stored.hosts.length > 0 ? <div className="flex flex-wrap gap-1.5">{stored.hosts.map((h) => <Chip key={h}>{h}</Chip>)}</div> : '—'}
        </DetailRow>
      </div>

      <div className="card p-4">
        <div className="mono-label mb-2">Certificate PEM</div>
        <RevealValue decrypt={() => decryptCertById(id).then((d) => d.certPem)} multiline />
        <div className="mono-label mt-4 mb-2">Private key PEM {stored.encKeyPem ? '' : '(not stored)'}</div>
        {stored.encKeyPem
          ? <RevealValue decrypt={() => decryptCertById(id).then((d) => d.keyPem ?? '')} multiline copyLabel="Private key copied" />
          : <div className="text-xs text-muted">No private key saved for this certificate.</div>}
      </div>

      {metaOpen && (
        <div className="modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="modal-panel card w-full max-w-sm p-5 anim-scale-in" onClick={(e) => e.stopPropagation()}>
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
            <div className="flex gap-2 justify-end mt-5">
              <button className="btn-ghost" onClick={() => setMetaOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => void saveMeta()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
