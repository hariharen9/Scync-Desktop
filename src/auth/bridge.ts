/**
 * Thin wrapper around Tauri commands and events.
 *
 * All calls degrade gracefully when not running inside Tauri (plain vite dev
 * in a system browser): commands reject with a clear error instead of
 * crashing, so the UI can show a diagnostics message.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, emit as tauriEmit, emitTo as tauriEmitTo } from '@tauri-apps/api/event';

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

/**
 * Emit to a single window only. Used to hand the master password from the
 * quick popup straight to the main window, so it is never broadcast to every
 * webview.
 */
export function emitTo(target: string, event: string, payload?: unknown): Promise<void> {
  if (!isTauri) return Promise.resolve();
  return tauriEmitTo(target, event, payload);
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
  openExternal(url: string): Promise<void> {
    return invoke('open_external', { url });
  },
  isBiometricAvailable(): Promise<boolean> {
    if (!isTauri) return Promise.resolve(false);
    return invoke<boolean>('is_biometric_available');
  },
  hasBiometricEnrolled(uid: string): Promise<boolean> {
    if (!isTauri) return Promise.resolve(false);
    return invoke<boolean>('has_biometric_enrolled', { uid });
  },
  enrollBiometric(uid: string, password: string): Promise<void> {
    return invoke('enroll_biometric', { uid, password });
  },
  unlockWithBiometric(uid: string): Promise<string> {
    return invoke<string>('unlock_with_biometric', { uid });
  },
  clearBiometric(uid: string): Promise<void> {
    if (!isTauri) return Promise.resolve();
    return invoke('clear_biometric', { uid });
  },
  destroyMainIfHidden(): Promise<void> {
    if (!isTauri) return Promise.resolve();
    return invoke('destroy_main_if_hidden');
  },
};

/**
 * Open a link in the system browser. Uses the Rust command inside Tauri and
 * falls back to a normal navigation in browser dev mode.
 */
export function openExternal(url: string): void {
  if (isTauri) {
    void invoke('open_external', { url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

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
