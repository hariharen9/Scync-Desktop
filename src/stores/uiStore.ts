/**
 * uiStore — active view, filters, modals, selected item, and non-secret
 * settings. Settings persist to the Tauri app-config dir via Rust
 * (`load_settings` / `save_settings`); localStorage is a dev-only fallback.
 */
import { create } from 'zustand';
import type { VaultFilter, Environment, SecretStatus, SecretType, ProjectColor } from '@/backend/index.js';
import { bridge, type SettingsFile, DEFAULT_SETTINGS_FALLBACK } from '@/lib/settings.js';

export type ActiveView = 'dashboard' | 'secrets' | 'passwords' | 'totp' | 'ssh' | 'certs' | 'projects' | 'settings';

export interface AppSettings extends SettingsFile {}

interface UiState {
  activeView: ActiveView;
  settings: AppSettings;
  settingsLoaded: boolean;
  filter: VaultFilter;
  selectedSecretId: string | null;
  /** id of the item whose form modal is open ('' = none) + the modal kind. */
  formModal: { kind: string | null; id: string | null };
  aboutOpen: boolean;
  confirm: { title: string; message: string; confirmText?: string; danger?: boolean; onConfirm: (() => void) | null } | null;
  toast: { text: string; detail?: string } | null;

  setView: (v: ActiveView) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  reloadSettings: () => Promise<void>;
  setFilter: (patch: Partial<VaultFilter>) => void;
  clearFilters: () => void;
  selectSecret: (id: string | null) => void;
  openForm: (kind: string, id?: string | null) => void;
  closeForm: () => void;
  setAboutOpen: (open: boolean) => void;
  askConfirm: (config: NonNullable<UiState['confirm']>) => void;
  resolveConfirm: () => void;
  dismissConfirm: () => void;
  showToast: (text: string, detail?: string) => void;
  clearToast: () => void;
}

const DEFAULT_FILTER: VaultFilter = {
  service: '',
  type: '',
  environment: '',
  status: '',
  projectId: '',
  search: '',
};

export const useUiStore = create<UiState>((set, get) => ({
  activeView: 'dashboard',
  settings: DEFAULT_SETTINGS_FALLBACK,
  settingsLoaded: false,
  filter: DEFAULT_FILTER,
  selectedSecretId: null,
  formModal: { kind: null, id: null },
  aboutOpen: false,
  confirm: null,
  toast: null,

  setView: (view) => set({ activeView: view, selectedSecretId: null }),

  patchSettings: (patch) => {
    const merged = { ...get().settings, ...patch };
    set({ settings: merged });
    void bridge.saveSettings(merged).catch(() => undefined);
  },

  reloadSettings: async () => {
    try {
      const file = await bridge.loadSettings();
      set({
        settings: { ...DEFAULT_SETTINGS_FALLBACK, ...file },
        settingsLoaded: true,
      });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
  clearFilters: () => set({ filter: DEFAULT_FILTER }),

  selectSecret: (id) => set({ selectedSecretId: id }),

  openForm: (kind, id = null) => set({ formModal: { kind, id } }),
  closeForm: () => set({ formModal: { kind: null, id: null } }),

  setAboutOpen: (open) => set({ aboutOpen: open }),

  askConfirm: (config) => set({ confirm: config }),
  resolveConfirm: () => {
    const { confirm } = get();
    confirm?.onConfirm?.();
    set({ confirm: null });
  },

  dismissConfirm: () => set({ confirm: null }),

  showToast: (text, detail) => set({ toast: { text, detail } }),
  clearToast: () => set({ toast: null }),
}));

/** Convenience selectors used by filter bars. */
export const filterKeys: Array<'service' | 'environment' | 'status' | 'type'> = [
  'service',
  'environment',
  'status',
  'type',
];

// Re-export domain enums so filter bars only import from here.
export type { Environment, SecretStatus, SecretType, ProjectColor };
