/**
 * DashboardView — the vault at a glance, modeled on the web app's dense
 * landing: a health score, stat tiles, an attention list, live 2FA access,
 * project counts, and recent activity. Every block is a shortcut into the
 * relevant view; nothing here decrypts on its own except the 2FA codes, which
 * are the one thing worth a live decrypt.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FiAlertTriangle, FiChevronRight, FiCopy, FiCheck, FiDatabase,
  FiFolder, FiKey, FiPlus, FiShield, FiTerminal, FiType, FiZap,
} from 'react-icons/fi';
import { useUiStore } from '@/stores/uiStore.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { getAttentionSecrets, getRemainingSeconds } from '@/backend/index.js';
import { ColorDot, formatDate } from '@/ui/components/common.js';
import { Chip, SectionLabel, useCopyFeedback } from '@/ui/components/primitives.js';
import { copyToSystemClipboard } from '@/lib/clipboard.js';
import { useNowInterval } from '@/ui/components/Toast.js';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardView() {
  const secrets = useDataStore((s) => s.secrets);
  const passwords = useDataStore((s) => s.passwords);
  const sshKeys = useDataStore((s) => s.sshKeys);
  const totpTokens = useDataStore((s) => s.totpTokens);
  const certificates = useDataStore((s) => s.certificates);
  const projects = useDataStore((s) => s.projects);
  const shares = useDataStore((s) => s.shares);
  const loaded = useDataStore((s) => s.loaded);
  const setView = useUiStore((s) => s.setView);
  const setViewWithSelection = useUiStore((s) => s.setViewWithSelection);
  const openForm = useUiStore((s) => s.openForm);
  const setFilter = useUiStore((s) => s.setFilter);
  const lockPhase = useVaultStore((s) => s.lockPhase);
  const attention = getAttentionSecrets(secrets);

  const now = new Date();
  const certsExpiring = certificates.filter(
    (c) => c.validTo < now || c.validTo.getTime() - now.getTime() < 30 * 24 * 3600 * 1000,
  );

  // Health score: mirror the web app's weighting so the number tells the same story.
  const score = useMemo(() => {
    if (secrets.length === 0) return certificates.length === 0 ? 100 : 92;
    let s = 100;
    const total = secrets.length;
    s -= Math.min(40, (attention.expired.length / total) * 80);
    s -= Math.min(25, (attention.expiringSoon.length / total) * 50);
    s -= Math.min(20, (attention.rotationOverdue.length / total) * 40);
    s -= Math.min(25, (attention.recoveryCodesLow.length / total) * 50);
    s -= Math.min(10, (certsExpiring.filter((c) => c.validTo < now).length / Math.max(total, 1)) * 30);
    return Math.max(0, Math.round(s));
  }, [secrets.length, attention, certsExpiring]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-rose-400';
  const scoreLabel = score >= 80 ? 'All clear' : score >= 50 ? 'Needs attention' : 'Critical';

  const totalItems = secrets.length + passwords.length + sshKeys.length + totpTokens.length + certificates.length;

  const attentionItems: Array<{ key: string; badge: string; tone: 'danger' | 'warn'; label: string; detail: string; onClick: () => void }> = [
    ...attention.expired.map((s) => ({ key: `exp-${s.id}`, badge: 'expired', tone: 'danger' as const, label: s.name, detail: `${s.service} · ${formatDate(s.expiresOn)}`, onClick: () => setViewWithSelection('secrets', s.id) })),
    ...attention.expiringSoon.map((s) => ({ key: `soon-${s.id}`, badge: 'expiring', tone: 'warn' as const, label: s.name, detail: `${s.service} · ${formatDate(s.expiresOn)}`, onClick: () => setViewWithSelection('secrets', s.id) })),
    ...attention.rotationOverdue.map((s) => ({ key: `rot-${s.id}`, badge: 'rotate', tone: 'warn' as const, label: s.name, detail: `${s.service} · since ${formatDate(s.lastRotated)}`, onClick: () => setViewWithSelection('secrets', s.id) })),
    ...attention.recoveryCodesLow.map((s) => ({ key: `rc-${s.id}`, badge: 'low codes', tone: 'danger' as const, label: s.name, detail: `${s.remainingCodes} left · ${s.service}`, onClick: () => setViewWithSelection('secrets', s.id) })),
    ...certsExpiring.map((c) => ({ key: `cert-${c.id}`, badge: c.validTo < now ? 'expired cert' : 'cert expiring', tone: (c.validTo < now ? 'danger' : 'warn') as 'danger' | 'warn', label: c.name, detail: formatDate(c.validTo), onClick: () => setViewWithSelection('certs', c.id) })),
  ];

  const recent = useMemo(
    () => [...secrets].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 5),
    [secrets],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        {/* Hero */}
        <div className="mb-6 anim-fade-up">
          <div className="mono-label flex items-center gap-1.5 mb-1.5">
            <span className="text-accent/70">//</span> vault overview
          </div>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight">
            {greeting()}. <span className="text-accent-light">Your vault is unlocked.</span>
          </h1>
          <p className="text-[12.5px] text-muted mt-1.5 font-mono">
            {totalItems} item{totalItems === 1 ? '' : 's'} · {projects.length} project{projects.length === 1 ? '' : 's'} · {lockPhase}
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={() => openForm('secret')}>
              <FiPlus size={13} /> Add secret
            </button>
            <button className="btn-ghost !py-1.5 !px-3 text-[12px]" onClick={() => openForm('password')}>
              <FiKey size={13} /> Add password
            </button>
            <button className="btn-ghost !py-1.5 !px-3 text-[12px]" onClick={() => openForm('project')}>
              <FiFolder size={13} /> New project
            </button>
          </div>
        </div>

        {/* Health + stats */}
        <div className="grid gap-3 md:grid-cols-[220px_1fr] mb-6 stagger-1">
          <div className="card p-5 flex flex-col items-center justify-center text-center">
            <div className={`font-mono text-[42px] font-bold leading-none tabular-nums ${scoreColor}`}>{score}</div>
            <div className="mono-label mt-1">/ 100 health</div>
            <div className={`text-[10px] font-mono uppercase tracking-wide mt-2 ${scoreColor}`}>{scoreLabel}</div>
            <div className="w-full h-1 rounded-full bg-white/[0.06] mt-3 overflow-hidden">
              <div
                className={'h-full rounded-full transition-[width] duration-700 ' + (score >= 80 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-rose-400')}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat icon={<FiDatabase size={14} />} label="Secrets" count={secrets.length} loading={!loaded.secrets} onClick={() => { setFilter({ search: '' }); setView('secrets'); }} />
            <Stat icon={<FiKey size={14} />} label="Passwords" count={passwords.length} loading={!loaded.passwords} onClick={() => setView('passwords')} />
            <Stat icon={<FiType size={14} />} label="2FA tokens" count={totpTokens.length} loading={!loaded.totpTokens} onClick={() => setView('totp')} />
            <Stat icon={<FiTerminal size={14} />} label="SSH keys" count={sshKeys.length} loading={!loaded.sshKeys} onClick={() => setView('ssh')} />
            <Stat icon={<FiShield size={14} />} label="Certificates" count={certificates.length} loading={!loaded.certificates} onClick={() => setView('certs')} />
            <Stat icon={<FiZap size={14} />} label="Active shares" count={shares.length} loading={!loaded.shares} onClick={() => setView('secrets')} />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mb-4 stagger-2">
          {/* Attention */}
          <div className="card p-4">
            <SectionLabel trailing={<FiAlertTriangle size={12} className={attentionItems.length ? 'text-amber-400' : 'text-subtle'} />}>
              Needs attention
            </SectionLabel>
            {attentionItems.length === 0 ? (
              <div className="flex items-center gap-2 py-3 text-[12.5px] text-muted">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Nothing is expiring or overdue.
              </div>
            ) : (
              <div className="space-y-1 -mx-1">
                {attentionItems.slice(0, 6).map((item) => (
                  <button key={item.key} onClick={item.onClick} className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors">
                    <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (item.tone === 'danger' ? 'bg-rose-400' : 'bg-amber-400')} />
                    <span className="text-[12.5px] truncate flex-1">{item.label}</span>
                    <Chip tone={item.tone}>{item.badge}</Chip>
                    <span className="text-[10.5px] text-subtle shrink-0 hidden sm:block max-w-[40%] truncate">{item.detail}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Live 2FA */}
          <QuickTwoFactor />
        </div>

        <div className="grid gap-4 lg:grid-cols-2 stagger-3">
          {/* Projects */}
          <div className="card p-4">
            <SectionLabel trailing={
              <button className="text-[11px] text-muted hover:text-accent-light transition-colors flex items-center gap-1" onClick={() => openForm('project')}>
                <FiPlus size={10} /> add
              </button>
            }>
              Projects
            </SectionLabel>
            {projects.length === 0 ? (
              <div className="py-3 text-[12.5px] text-muted">
                No projects yet. <button className="text-accent-light hover:underline" onClick={() => openForm('project')}>Create one</button> to group secrets.
              </div>
            ) : (
              <div className="space-y-1 -mx-1">
                {[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
                  const count = secrets.filter((s) => s.projectId === p.id).length;
                  return (
                    <button
                      key={p.id}
                      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] text-left transition-colors group"
                      onClick={() => { setView('secrets'); setFilter({ projectId: p.name }); }}
                    >
                      <ColorDot color={p.color} />
                      <span className="text-[12.5px] flex-1 truncate">{p.icon && <span className="mr-1.5">{p.icon}</span>}{p.name}</span>
                      <span className="mono-label tabular-nums">{count}</span>
                      <FiChevronRight size={13} className="text-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="card p-4">
            <SectionLabel trailing={
              secrets.length > 0 ? (
                <button className="text-[11px] text-muted hover:text-accent-light transition-colors flex items-center gap-1" onClick={() => setView('secrets')}>
                  view all <FiChevronRight size={10} />
                </button>
              ) : undefined
            }>
              Recent activity
            </SectionLabel>
            {recent.length === 0 ? (
              <div className="py-3 text-[12.5px] text-muted">No activity yet.</div>
            ) : (
              <div className="relative pl-1">
                {recent.map((s, i) => {
                  const wasUpdated = s.updatedAt.getTime() - s.createdAt.getTime() > 60_000;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setViewWithSelection('secrets', s.id)}
                      className="w-full flex gap-2.5 text-left group"
                    >
                      <div className="flex flex-col items-center pt-1.5">
                        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (wasUpdated ? 'bg-amber-400' : 'bg-emerald-400')} />
                        {i < recent.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className={'min-w-0 flex-1 ' + (i < recent.length - 1 ? 'pb-3' : 'pb-0')}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12.5px] font-medium truncate group-hover:text-accent-light transition-colors">{s.name}</span>
                          <Chip tone={wasUpdated ? 'warn' : 'accent'}>{wasUpdated ? 'updated' : 'created'}</Chip>
                        </div>
                        <div className="text-[10.5px] text-subtle mt-0.5">{formatRelativeShort(s.updatedAt)} · {s.service}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelativeShort(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Stat({ icon, label, count, onClick, loading }: { icon: ReactNode; label: string; count: number; onClick: () => void; loading?: boolean }) {
  return (
    <button className="card p-3.5 text-left hover:border-border-strong hover:bg-panel-2 transition-colors group" onClick={onClick}>
      <div className="flex items-center gap-2 text-subtle group-hover:text-muted transition-colors">
        {icon}<span className="mono-label">{label}</span>
      </div>
      <div className="font-display text-[22px] font-bold mt-1.5 tabular-nums leading-none">
        {loading ? <span className="inline-block w-6 h-5 skeleton rounded" /> : count}
      </div>
    </button>
  );
}

/** Live TOTP codes for the first two tokens, decrypting once per window. */
function QuickTwoFactor() {
  const totpTokens = useDataStore((s) => s.totpTokens);
  const totpCodeFor = useDataStore((s) => s.totpCodeFor);
  const setView = useUiStore((s) => s.setView);
  const [codes, setCodes] = useState<Record<string, { code: string; remaining: number }>>({});
  const { copied, run } = useCopyFeedback();
  const now = useNowInterval(1000, totpTokens.length > 0);

  const tokens = totpTokens.slice(0, 2);
  const windowKey = tokens.map((t) => Math.floor(now / 1000 / t.period)).join(',');

  useEffect(() => {
    // Decrypt each visible token once per code window (not every tick).
    if (tokens.length === 0) return;
    let cancelled = false;
    for (const t of tokens) {
      void totpCodeFor(t.id).then((r) => {
        if (cancelled) return;
        setCodes((prev) => (prev[t.id]?.code === r.code ? prev : { ...prev, [t.id]: r }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
    // windowKey changes only when a code window rolls over; the countdown is
    // recomputed from `now` at render time without re-decrypting.
  }, [windowKey, tokens.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card p-4">
      <SectionLabel trailing={
        totpTokens.length > 0 ? (
          <button className="text-[11px] text-muted hover:text-accent-light transition-colors flex items-center gap-1" onClick={() => setView('totp')}>
            view all <FiChevronRight size={10} />
          </button>
        ) : undefined
      }>
        <span className="flex items-center gap-1.5"><FiShield size={11} /> 2FA quick access</span>
      </SectionLabel>
      {totpTokens.length === 0 ? (
        <div className="py-3 text-[12.5px] text-muted">No authenticator tokens yet.</div>
      ) : (
        <div className="space-y-1.5">
          {tokens.map((t) => {
            const entry = codes[t.id];
            const remaining = entry?.remaining ?? getRemainingSeconds(t.period);
            const low = remaining <= 5;
            const pct = (remaining / t.period) * 100;
            return (
              <button
                key={t.id}
                onClick={() => entry && void run(() => copyToSystemClipboard(entry.code, 'Code copied'))}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg border border-border bg-black/20 hover:border-border-strong transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="mono-label truncate">{t.issuer || 'token'}</div>
                  <div className={`font-mono text-[16px] font-bold tracking-[0.14em] tabular-nums ${low ? 'text-rose-400' : 'text-accent-light'}`}>
                    {entry ? `${entry.code.slice(0, Math.ceil(entry.code.length / 2))} ${entry.code.slice(Math.ceil(entry.code.length / 2))}` : '••• •••'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-10 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                    <div className={'h-full rounded-full transition-[width] duration-1000 ' + (low ? 'bg-rose-400' : 'bg-accent')} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`mono-label tabular-nums w-5 text-right ${low ? 'text-rose-300' : ''}`}>{remaining}</span>
                  {copied ? <FiCheck size={12} className="text-accent-light" /> : <FiCopy size={12} className="text-subtle" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
