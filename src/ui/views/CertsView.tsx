/** CertsView — certificates with parsed metadata and expiry tracking. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { FiEdit2, FiShield, FiTrash2 } from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { AlertBlock, EmptyState, RevealValue, formatDate } from '@/ui/components/common.js';
import { Chip, CopyIconButton, ListSkeleton } from '@/ui/components/primitives.js';
import { DetailBody, DetailHeader, ListHeader, MasterDetail, MetaCell, MetaGrid, SearchField } from '@/ui/components/masterDetail.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { pushToast } from '@/ui/components/Toast.js';
import type { StoredCertificate } from '@/backend/index.js';

const SOON_MS = 30 * 24 * 3600 * 1000;

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

  // Selection resolves against all certs so it survives an active filter.
  const selected = certificates.find((c) => c.id === selectedId) ?? null;
  const now = Date.now();
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

  const expiringCount = certificates.filter((c) => c.validTo.getTime() - now < SOON_MS).length;

  return (
    <MasterDetail
      hasSelection={Boolean(selected)}
      list={() => (
        <>
          <ListHeader
            title="Certificates"
            subtitle={
              <>
                {sorted.length} certificate{sorted.length === 1 ? '' : 's'}
                {expiringCount > 0 && <span className="text-amber-300"> · {expiringCount} need attention</span>}
              </>
            }
            onNew={() => openForm('cert')}
          >
            {certificates.length > 0 && (
              <SearchField
                inputRef={searchRef}
                value={query}
                onChange={setQuery}
                placeholder="Filter certificates…"
              />
            )}
          </ListHeader>

          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {!loaded.certificates ? (
              <ListSkeleton rows={7} />
            ) : sorted.length === 0 ? (
              <div className="text-center px-4 mt-12">
                <p className="text-[12.5px] text-muted">{hasFilter ? 'No certificates match.' : 'No certificates yet.'}</p>
                {!hasFilter && <button className="btn-primary !py-1.5 !px-3 text-[12px] mt-3" onClick={() => openForm('cert')}>Add certificate</button>}
              </div>
            ) : (
              sorted.map((c) => <CertRow key={c.id} entry={c} selected={c.id === selectedId} now={now} onSelect={() => selectSecret(c.id)} />)
            )}
          </div>
        </>
      )}
      detail={(compact) => selected ? (
        <CertDetail key={selected.id} entry={selected} compact={compact} onBack={() => selectSecret(null)} />
      ) : null}
      empty={loaded.certificates ? (
        <EmptyState icon={<FiShield size={20} />} title="Select a certificate" hint="Paste a PEM to parse its metadata — the PEM and key are encrypted at rest." />
      ) : null}
    />
  );
}

function CertRow({ entry, selected, now, onSelect }: {
  entry: StoredCertificate;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const expired = entry.validTo.getTime() < now;
  const soon = !expired && entry.validTo.getTime() - now < SOON_MS;
  const dot = expired ? 'bg-rose-400' : soon ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <button
      id={`cert-row-${entry.id}`}
      onClick={onSelect}
      className={
        'group w-full text-left rounded-lg border px-2.5 py-1.5 mb-0.5 transition-colors ' +
        (selected ? 'bg-accent-dim border-accent-border' : 'border-transparent hover:bg-white/[0.04]')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + dot} title={expired ? 'Expired' : soon ? 'Expires within 30 days' : 'Valid'} />
        <span className="text-[12.5px] font-medium truncate flex-1">{entry.name}</span>
      </div>
      <div className="text-[10.5px] truncate mt-0.5 pl-3.5">
        {expired
          ? <span className="text-rose-300">expired {formatDate(entry.validTo)}</span>
          : <span className="text-subtle">expires {formatDate(entry.validTo)}</span>}
      </div>
    </button>
  );
}

function CertDetail({ entry, compact, onBack }: {
  entry: StoredCertificate;
  compact: boolean;
  onBack: () => void;
}) {
  const askConfirm = useUiStore((s) => s.askConfirm);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const decryptCertById = useDataStore((s) => s.decryptCertById);
  const removeCertificate = useDataStore((s) => s.removeCertificate);
  const [metaOpen, setMetaOpen] = useState(false);
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');

  const now = Date.now();
  const expired = entry.validTo.getTime() < now;
  const soon = !expired && entry.validTo.getTime() - now < SOON_MS;

  const doDelete = () => askConfirm({
    title: 'Delete certificate',
    message: `Permanently delete "${entry.name}" (and its private key, if stored)? This cannot be undone.`,
    confirmText: 'Delete',
    danger: true,
    onConfirm: () => {
      void removeCertificate(entry.id)
        .then(() => { selectSecret(null); pushToast.success('Certificate deleted'); })
        .catch((e) => pushToast.fromError(e));
    },
  });

  const saveMeta = async () => {
    try {
      await useDataStore.getState().updateCertMeta(entry.id, {
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
    <>
      <DetailHeader
        title={entry.name}
        onBack={compact ? onBack : undefined}
        badges={
          <>
            {expired && <Chip tone="danger">expired</Chip>}
            {soon && <Chip tone="warn">expiring</Chip>}
          </>
        }
        subtitle={<div className="text-[12px] text-muted break-all">{entry.subject}</div>}
        actions={
          <>
            <button
              className="icon-btn"
              onClick={() => { setName(entry.name); setHosts(entry.hosts.join(', ')); setMetaOpen(true); }}
              title="Edit metadata" aria-label="Edit metadata"
            >
              <FiEdit2 size={15} />
            </button>
            <button className="icon-btn icon-btn-danger" onClick={doDelete} title="Delete" aria-label="Delete"><FiTrash2 size={15} /></button>
          </>
        }
      />
      <DetailBody>
        {(expired || soon) && (
          <div className="mb-4">
            <AlertBlock tone={expired ? 'danger' : 'warn'} icon={<span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-current shrink-0" />}>
              {expired ? `This certificate expired on ${formatDate(entry.validTo)}.` : `This certificate expires on ${formatDate(entry.validTo)}.`}
            </AlertBlock>
          </div>
        )}

        <MetaGrid>
          <MetaCell label="Issuer">{entry.issuer}</MetaCell>
          <MetaCell label="Self-signed">{entry.isSelfSigned ? 'yes' : 'no'}</MetaCell>
          <MetaCell label="Valid from">{formatDate(entry.validFrom)}</MetaCell>
          <MetaCell label="Valid to">{formatDate(entry.validTo)}</MetaCell>
          <MetaCell label="Serial" wrap mono>{entry.serialNumber}</MetaCell>
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
        </MetaGrid>

        <section className="card p-4 mt-4">
          <div className="mono-label mb-2">Certificate PEM</div>
          <RevealValue decrypt={() => decryptCertById(entry.id).then((d) => d.certPem)} multiline />
          <div className="mono-label mt-4 mb-2">Private key PEM {entry.encKeyPem ? '' : '(not stored)'}</div>
          {entry.encKeyPem
            ? <RevealValue decrypt={() => decryptCertById(entry.id).then((d) => d.keyPem ?? '')} multiline copyLabel="Private key copied" />
            : <div className="text-[12.5px] text-subtle">No private key saved for this certificate.</div>}
        </section>
      </DetailBody>

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
    </>
  );
}
