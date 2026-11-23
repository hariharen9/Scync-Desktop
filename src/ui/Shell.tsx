/**
 * Shell: sidebar navigation with live counts, active view, shared modals
 * (form, confirm, about, command palette), and the toast overlay. Detail is
 * list/detail inside each view.
 */
import type { User } from 'firebase/auth';
import { useEffect, type ReactNode } from 'react';
import {
  FiActivity, FiCommand, FiDatabase, FiFolder, FiInfo, FiKey,
  FiLock, FiLogOut, FiSettings, FiShield, FiTerminal, FiType,
} from 'react-icons/fi';
import { useUiStore, type ActiveView } from '@/stores/uiStore.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { lockNow } from '@/lib/autoLock.js';
import { getAttentionSecrets } from '@/backend/index.js';
import { pushToast } from './components/Toast.js';
import { Avatar, BrandMark, ModKbd, MOD_KEY, Wordmark } from './components/primitives.js';

import DashboardView from './views/DashboardView.js';
import SecretsView from './views/SecretsView.js';
import PasswordsView from './views/PasswordsView.js';
import TotpView from './views/TotpView.js';
import SshView from './views/SshView.js';
import CertsView from './views/CertsView.js';
import ProjectsView from './views/ProjectsView.js';
import SettingsView from './views/SettingsView.js';
import FormModal from './components/FormModal.js';
import ConfirmModal from './components/ConfirmModal.js';
import Toast from './components/Toast.js';
import AboutModal from './components/AboutModal.js';
import CommandPalette from './components/CommandPalette.js';

interface NavItem {
  id: ActiveView;
  label: string;
  icon: ReactNode;
  count?: number;
}

export default function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const activeView = useUiStore((s) => s.activeView);
  const setView = useUiStore((s) => s.setView);
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const lockPhase = useVaultStore((s) => s.lockPhase);
  const email = user.email ?? '';
  const displayName = user.displayName ?? '';
  const secrets = useDataStore((s) => s.secrets);
  const passwords = useDataStore((s) => s.passwords);
  const sshKeys = useDataStore((s) => s.sshKeys);
  const totpTokens = useDataStore((s) => s.totpTokens);
  const certificates = useDataStore((s) => s.certificates);
  const projects = useDataStore((s) => s.projects);
  const attention = getAttentionSecrets(secrets);
  const attentionCount = attention.expired.length + attention.expiringSoon.length + attention.rotationOverdue.length + attention.recoveryCodesLow.length;

  // ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCommandPaletteOpen]);

  const nav: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <FiActivity size={15} /> },
    { id: 'secrets', label: 'Secrets', icon: <FiDatabase size={15} />, count: secrets.length },
    { id: 'passwords', label: 'Passwords', icon: <FiKey size={15} />, count: passwords.length },
    { id: 'totp', label: 'Authenticator', icon: <FiType size={15} />, count: totpTokens.length },
    { id: 'ssh', label: 'SSH keys', icon: <FiTerminal size={15} />, count: sshKeys.length },
    { id: 'certs', label: 'Certificates', icon: <FiShield size={15} />, count: certificates.length },
    { id: 'projects', label: 'Projects', icon: <FiFolder size={15} />, count: projects.length },
  ];

  const handleSignOut = () => {
    useUiStore.getState().askConfirm({
      title: 'Sign out of Scync?',
      message: 'Your vault will lock and the derived key is discarded. The Firebase session ends; you will need to sign in again.',
      confirmText: 'Sign out',
      danger: false,
      onConfirm: () => { lockNow('sign-out'); void onSignOut(); },
    });
  };

  return (
    <div className="h-full flex">
      {/* ─── Sidebar ─── */}
      <aside className="w-[216px] shrink-0 border-r border-border bg-panel flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <BrandMark size={22} glow />
            <Wordmark small />
          </div>
          <div className="mono-label mt-1 flex items-center gap-1.5 pl-[32px]">
            <span className={`w-1.5 h-1.5 rounded-full ${lockPhase === 'unlocked' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {lockPhase}
          </div>
        </div>

        {/* Quick search trigger */}
        <div className="px-3 pb-3">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-white/[0.02] text-subtle hover:text-muted hover:border-border-strong transition-colors"
          >
            <FiCommand size={12} />
            <span className="text-[12px] flex-1 text-left">Search…</span>
            <ModKbd keyName="K" />
          </button>
        </div>

        <nav className="px-2 flex-1 overflow-y-auto">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={
                'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] mb-0.5 transition-colors group ' +
                (activeView === item.id
                  ? 'bg-accent-dim text-accent-light border border-accent-border'
                  : 'text-muted hover:text-text hover:bg-white/[0.04] border border-transparent')
              }
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === 'dashboard' && attentionCount > 0 ? (
                <span className="text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5 tabular-nums">
                  {attentionCount}
                </span>
              ) : item.count !== undefined ? (
                <span className={
                  'text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded ' +
                  (activeView === item.id ? 'text-accent-light/80' : 'text-subtle')
                }>
                  {item.count}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="px-2 py-2 border-t border-border">
          <button
            onClick={() => setView('settings')}
            className={'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] mb-0.5 transition-colors ' + (activeView === 'settings' ? 'bg-accent-dim text-accent-light border border-accent-border' : 'text-muted hover:text-text hover:bg-white/[0.04] border border-transparent')}
          >
            <FiSettings size={15} /> <span className="flex-1 text-left">Settings</span>
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-muted hover:text-text hover:bg-white/[0.04] border border-transparent transition-colors"
            onClick={() => useUiStore.getState().setAboutOpen(true)}
          >
            <FiInfo size={15} /> <span className="flex-1 text-left">About</span>
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 mt-1.5 rounded-lg text-[13px] bg-accent hover:bg-accent-light text-[#04120d] font-semibold transition-colors"
            onClick={() => { void lockNow('manual'); pushToast.success('Vault locked', 'Key discarded from memory'); }}
          >
            <FiLock size={14} /> <span className="flex-1 text-left">Lock now</span>
            <span className="inline-flex items-center gap-0.5 opacity-70">
              <kbd className="kbd !bg-black/15 !border-black/25 !text-[#04120d]">{MOD_KEY}</kbd>
              <kbd className="kbd !bg-black/15 !border-black/25 !text-[#04120d]">L</kbd>
            </span>
          </button>

          <div className="flex items-center gap-2.5 px-2 py-2 mt-2 rounded-lg border border-border bg-white/[0.02]">
            <Avatar name={displayName} email={email} photoURL={user.photoURL} size={26} />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium truncate leading-tight">{displayName || email.split('@')[0]}</div>
              <div className="text-[10px] text-subtle truncate leading-tight" title={email}>{email}</div>
            </div>
            <button
              className="icon-btn !w-7 !h-7 shrink-0"
              onClick={handleSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <FiLogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Content ─── */}
      <main className="flex-1 overflow-hidden relative bg-bg">
        <div key={activeView} className="h-full anim-fade-in">
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'secrets' && <SecretsView />}
          {activeView === 'passwords' && <PasswordsView />}
          {activeView === 'totp' && <TotpView />}
          {activeView === 'ssh' && <SshView />}
          {activeView === 'certs' && <CertsView />}
          {activeView === 'projects' && <ProjectsView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </main>

      <FormModal />
      <ConfirmModal />
      <AboutModal />
      <CommandPalette />
      <Toast />
    </div>
  );
}
