/**
 * Thin wrapper around Tauri commands and events.
 *
 * All calls degrade gracefully when not running inside Tauri (plain vite dev
 * in a system browser): commands reject with a clear error instead of
 * crashing, so the UI can show a diagnostics message.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, emit as tauriEmit } from '@tauri-apps/api/event';

export const isTauri = '__TAURI_INTERNALS__' in (typeof window !== 'undefined' ? window : {});

export type OAuthTokens = { idToken: string; accessToken: string };

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    throw new Error(`SCYNC_DEV: command '${cmd}' is only available inside the Scync desktop app.`);
  }
  return tauriInvoke<T>(cmd, args);
}

/** Typed event helper (Tauri events only carry JSON). */
export function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  return tauriListen<T>(event, (e) => handler(e.payload));
}

export function emit(event: string, payload?: unknown): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return tauriEmit(event, payload);
}

// Command wrappers ──────────────────────────────────────────────────────────

export const bridge = {
  googleSignIn(clientId: string, clientSecret: string): Promise<OAuthTokens> {
    return invoke<OAuthTokens>('google_sign_in', { clientId, clientSecret });
  },
  copySecret(text: string, clearAfterSecs: number): Promise<void> {
    return invoke('copy_secret', { text, clearAfterSecs });
  },
  loadSettings(): Promise<never | Partial<SettingsFile>> {
    return invoke('load_settings');
  },
  saveSettings(settings: unknown): Promise<void> {
    return invoke('save_settings', { settingsData: settings });
  },
  registerHotkey(accelerator: string): Promise<boolean> {
    return invoke('register_hotkey', { accelerator });
  },
  getHotkey(): Promise<string> {
    return invoke('get_hotkey');
  },
  showMainWindow(): Promise<void> {
    return invoke('show_main_window');
  },
  hideQuickWindow(): Promise<void> {
    return invoke('hide_quick_window');
  },
  isAutostartEnabled(): Promise<boolean> {
    return invoke('is_autostart_enabled');
  },
  toggleAutostart(enable: boolean): Promise<void> {
    return invoke('toggle_autostart', { enable });
  },
  quitApp(): Promise<void> {
    return invoke('quit_app');
  },
};

export interface SettingsFile {
  hotkey: string;
  idleLockMinutes: number | null;
  hiddenLockMinutes: number | null;
  clipboardClearSecs: number;
  contentProtection: boolean;
}
