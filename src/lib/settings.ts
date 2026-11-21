/**
 * Settings plumbing: Rust-backed persistence with a dev fallback.
 * DEFAULT values mirror src-tauri/src/settings.rs — keep in sync.
 */
export { bridge } from '@/auth/bridge';

export interface SettingsFile {
  hotkey: string;
  idleLockMinutes: number | null;
  hiddenLockMinutes: number | null;
  clipboardClearSecs: number;
  contentProtection: boolean;
}

export const DEFAULT_SETTINGS_FALLBACK: SettingsFile = {
  hotkey: 'CommandOrControl+Shift+Space',
  idleLockMinutes: 5,
  hiddenLockMinutes: 5,
  clipboardClearSecs: 20,
  contentProtection: true,
};
