/** DashboardView — vault health at a glance: counts, attention items, shares. */
import { FiAlertTriangle, FiArchive, FiKey, FiShield, FiTerminal, FiType, FiUsers } from 'react-icons/fi';
import type { ReactNode } from 'react';
import { useUiStore } from '@/stores/uiStore.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getAttentionSecrets } from '@/backend/index.js';
import { ColorDot, ViewHeader, formatDate } from '@/ui/components/common.js';

export default function DashboardView() {
  const secrets = useDataStore((s) => s.secrets);
  const passwords = useDataStore((s) => s.passwords);
  const sshKeys = useDataStore((s) => s.sshKeys);
  const totpTokens = useDataStore((s) => s.totpTokens);
  const certificates = useDataStore((s) => s.certificates);
  const projects = useDataStore((s) => s.projects);
  const shares = useDataStore((s) => s.shares);
  const setView = useUiStore((s) => s.setView);
  const selectSecret = useUiStore((s) => s.selectSecret);
  const openForm = useUiStore((s) => s.openForm);
  const lockPhase = useVaultStore((s) => s.lockPhase);
  const attention = getAttentionSecrets(secrets);

  const now = new Date();
  const certsExpiring = certificates.filter(
    (c) => c.validTo < now || c.validTo.getTime() - now.getTime() < 30 * 24 * 3600 * 1000,
  );

  const attentionItems: Array<{ key: string; label: string; detail: string; onClick: () => void }> = [
    ...attention.expired.map((s) => ({
      key: `exp-${s.id}`,
      label: `${s.name} · ${s.service}`,
      detail: `expired ${formatDate(s.expiresOn)}`,
      onClick: () => { setView('secrets'); selectSecret(s.id); },
    })),
    ...attention.rotationOverdue.map((s) => ({
      key: `rot-${s.id}`,
      label: `${s.name} · ${s.service}`,
      detail: `not rotated since ${formatDate(s.lastRotated)}`,
      onClick: () => { setView('secrets'); selectSecret(s.id); },
    })),
    ...attention.recoveryCodesLow.map((s) => ({
      key: `rc-${s.id}`,
      label: `${s.name} · ${s.service}`,
      detail: `only ${s.remainingCodes} recovery code(s) left`,
      onClick: () => { setView('secrets'); selectSecret(s.id); },
    })),
    ...certsExpiring.map((c) => ({
      key: `cert-${c.id}`,
      label: `${c.name}`,
      detail: c.validTo < now ? `certificate expired ${formatDate(c.validTo)}` : `certificate expires ${formatDate(c.validTo)}`,
      onClick: () => { setView('certs'); selectSecret(c.id); },
    })),
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <ViewHeader title="Dashboard" subtitle={`vault ${lockPhase} · ${secrets.length + passwords.length + sshKeys.length + totpTokens.length + certificates.length} items`} />

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6 max-w-4xl mb-6">
        <Stat icon={<FiArchive size={15} />} label="Secrets" count={secrets.length} onClick={() => setView('secrets')} />
        <Stat icon={<FiKey size={15} />} label="Passwords" count={passwords.length} onClick={() => setView('passwords')} />
        <Stat icon={<FiType size={15} />} label="TOTP" count={totpTokens.length} onClick={() => setView('totp')} />
        <Stat icon={<FiTerminal size={15} />} label="SSH keys" count={sshKeys.length} onClick={() => setView('ssh')} />
        <Stat icon={<FiShield size={15} />} label="Certificates" count={certificates.length} onClick={() => setView('certs')} />
        <Stat icon={<FiUsers size={15} />} label="Shares" count={shares.length} onClick={() => setView('secrets')} />
      </div>

      <div className="max-w-4xl">
        <h2 className="mono-label mb-2">Needs attention</h2>
        <div className="card divide-y divide-border">
          {attentionItems.length === 0 ? (
            <div className="p-4 text-xs text-muted flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              Nothing is expiring or overdue. Open the web app to add more secrets.
            </div>
          ) : (
            attentionItems.map((item) => (
              <button key={item.key} className="w-full flex items-center gap-3 p-3.5 hover:bg-white/5 text-left" onClick={item.onClick}>
                <FiAlertTriangle className="text-warn shrink-0" size={14} />
                <span className="text-[13px] truncate flex-1">{item.label}</span>
                <span className="text-[11px] text-subtle shrink-0 hidden sm:block">{item.detail}</span>
              </button>
            ))
          )}
        </div>

        <h2 className="mono-label mt-6 mb-2">Projects</h2>
        <div className="card divide-y divide-border">
          {projects.length === 0 ? (
            <div className="p-4 text-xs text-muted">
              No projects yet. <button className="text-accent-light hover:underline" onClick={() => openForm('project')}>Create one</button> to group secrets.
            </div>
          ) : (
            [...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <button key={p.id} className="w-full flex items-center gap-3 p-3.5 hover:bg-white/5 text-left" onClick={() => { setView('secrets'); useUiStore.getState().setFilter({ projectId: p.id }); }}>
                <ColorDot color={p.color} />
                <span className="text-[13px] flex-1 truncate">{p.icon && <span className="mr-1.5">{p.icon}</span>}{p.name}</span>
                <span className="mono-label">{secrets.filter((s) => s.projectId === p.id).length}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, count, onClick }: { icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button className="card p-4 text-left hover:border-foreground/40 transition-colors" onClick={onClick}>
      <div className="flex items-center gap-2 text-muted">{icon}<span className="mono-label">{label}</span></div>
      <div className="font-display text-xl font-bold mt-2 tabular-nums">{count}</div>
    </button>
  );
}
