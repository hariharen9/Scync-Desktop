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
  helloEnabled: boolean;
  requirePasswordEveryDays: number | null;
  lastPasswordUnlockAt: number | null;
}

export const DEFAULT_SETTINGS_FALLBACK: SettingsFile = {
  hotkey: 'CommandOrControl+Shift+Backslash',
  idleLockMinutes: 5,
  hiddenLockMinutes: 5,
  clipboardClearSecs: 20,
  contentProtection: true,
  helloEnabled: false,
  requirePasswordEveryDays: 14,
  lastPasswordUnlockAt: null,
};

const DAY_MS = 86_400_000;

/**
 * Whether the periodic master-password check is due.
 * Returns true if the user has never unlocked with their master password
 * on this device, or if `requirePasswordEveryDays` has elapsed.
 */
export function isPasswordRequiredNow(
  settings: Pick<SettingsFile, 'requirePasswordEveryDays' | 'lastPasswordUnlockAt'>,
  nowMs = Date.now(),
): boolean {
  if (!settings.lastPasswordUnlockAt) return true;
  const days = settings.requirePasswordEveryDays;
  if (days === null || days === undefined || days <= 0) return false;
  return nowMs - settings.lastPasswordUnlockAt >= days * DAY_MS;
}
