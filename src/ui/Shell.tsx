/**
 * Shell: sidebar navigation, active view, shared modals (form, confirm,
 * about), toast overlay. Detail is list/detail inside each view.
 */
import type { User } from 'firebase/auth';
import { ReactNode } from 'react';
import {
  FiActivity, FiFolder, FiSettings, FiInfo, FiKey, FiType,
  FiShield, FiDatabase, FiLock, FiTerminal,
} from 'react-icons/fi';
import { useUiStore, type ActiveView } from '@/stores/uiStore.js';
import { useVaultStore } from '@/stores/vaultStore.js';
import { useDataStore } from '@/stores/dataStore.js';
import { lockNow } from '@/lib/autoLock.js';
import { getAttentionSecrets } from '@/backend/index.js';

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

const NAV: Array<{ id: ActiveView; label: string; icon: ReactNode }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <FiActivity size={15} /> },
  { id: 'secrets', label: 'Secrets', icon: <FiDatabase size={15} /> },
  { id: 'passwords', label: 'Passwords', icon: <FiKey size={15} /> },
  { id: 'totp', label: 'TOTP', icon: <FiType size={15} /> },
  { id: 'ssh', label: 'SSH Keys', icon: <FiTerminal size={15} /> },
  { id: 'certs', label: 'Certificates', icon: <FiShield size={15} /> },
  { id: 'projects', label: 'Projects', icon: <FiFolder size={15} /> },
];

export default function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const activeView = useUiStore((s) => s.activeView);
  const setView = useUiStore((s) => s.setView);
  const lockPhase = useVaultStore((s) => s.lockPhase);
  const email = user.email ?? '';
  const secrets = useDataStore((s) => s.secrets);
  const attention = getAttentionSecrets(secrets);
  const attentionCount = attention.expired.length + attention.recoveryCodesLow.length;

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 border-r border-border bg-panel flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <div className="font-display font-extrabold tracking-tight text-sm">SCYNC</div>
          <div className="mono-label mt-0.5">desktop · {lockPhase}</div>
        </div>

        <nav className="px-2 flex-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 transition-colors ' +
                (activeView === item.id
                  ? 'bg-accent-dim text-accent-light border border-accent-border'
                  : 'text-muted hover:text-text hover:bg-white/5 border border-transparent')
              }
            >
              {item.icon}
              <span>{item.label}</span>
              {item.id === 'dashboard' && attentionCount > 0 && (
                <span className="ml-auto text-[10px] font-mono bg-warn/20 text-warn rounded px-1.5 py-0.5">
                  {attentionCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-2 pb-3">
          <button
            onClick={() => setView('settings')}
            className={'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 ' + (activeView === 'settings' ? 'bg-accent-dim text-accent-light border border-accent-border' : 'text-muted hover:text-text hover:bg-white/5 border border-transparent')}
          >
            <FiSettings size={15} /> <span>Settings</span>
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted hover:text-text hover:bg-white/5 border border-transparent"
            onClick={() => useUiStore.getState().setAboutOpen(true)}
          >
            <FiInfo size={15} /> <span>About</span>
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 mt-2 rounded-lg text-[13px] bg-accent hover:bg-accent-light text-bg font-semibold"
            onClick={() => lockNow('manual')}
          >
            <FiLock size={14} /> <span>Lock now</span>
          </button>
          <div className="px-3 pt-3 pb-1 mono-label truncate" title={email}>
            {email}
          </div>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted hover:text-text hover:bg-white/5 border border-transparent"
            onClick={() => void onSignOut()}
          >
            {'Sign out'}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-hidden relative">
        {activeView === 'dashboard' && <DashboardView />}
        {activeView === 'secrets' && <SecretsView />}
        {activeView === 'passwords' && <PasswordsView />}
        {activeView === 'totp' && <TotpView />}
        {activeView === 'ssh' && <SshView />}
        {activeView === 'certs' && <CertsView />}
        {activeView === 'projects' && <ProjectsView />}
        {activeView === 'settings' && <SettingsView />}
      </main>

      <FormModal />
      <ConfirmModal />
      <AboutModal />
      <Toast />
    </div>
  );
}
