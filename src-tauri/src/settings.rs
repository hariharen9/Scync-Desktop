//! Non-secret settings, persisted in the Tauri app-config directory
//! (e.g. `%APPDATA%/space.scync.desktop/settings.json` on Windows,
//! `~/Library/Application Support/space.scync.desktop/` on macOS).
//! Never store vault secrets, tokens, or the master password here.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// Ctrl/Cmd+Shift+Space (1Password's binding) and Ctrl+Space (VS Code parameter
// hints, Windows IME) are commonly taken, so the default uses Backslash: no
// binding on Windows or macOS, and not used by the major browsers.
pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Backslash";

/// The previous default. Users who never changed it are moved to the new one,
/// since the old binding silently failed to register on common setups.
const LEGACY_DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Global quick-search hotkey (accelerator string).
    pub hotkey: String,
    /// Auto-lock after idle minutes; None disables.
    pub idle_lock_minutes: Option<u64>,
    /// Auto-lock after the window has been hidden for N minutes; None disables.
    pub hidden_lock_minutes: Option<u64>,
    /// Clipboard auto-clear seconds for copied secrets.
    pub clipboard_clear_secs: u64,
    /// Window content protection (screenshot/recording shield), best-effort.
    pub content_protection: bool,
    /// Unlock with Windows Hello / PIN enabled (opt-in).
    pub hello_enabled: bool,
    /// Require the master password every N days even when Windows Hello is enabled (None = never).
    pub require_password_every_days: Option<u64>,
    /// Epoch ms of the most recent master-password unlock (drives periodic check).
    pub last_password_unlock_at: Option<u64>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            hotkey: DEFAULT_HOTKEY.into(),
            idle_lock_minutes: Some(5),
            hidden_lock_minutes: Some(5),
            clipboard_clear_secs: 20,
            content_protection: true,
            hello_enabled: false,
            require_password_every_days: Some(14),
            last_password_unlock_at: None,
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    dir.join("settings.json")
}

pub fn load(app: &tauri::AppHandle) -> Settings {
    let path = settings_path(app);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let mut settings: Settings = serde_json::from_str(&text).unwrap_or_default();
            if settings.hotkey == LEGACY_DEFAULT_HOTKEY {
                settings.hotkey = DEFAULT_HOTKEY.into();
            }
            settings
        }
        Err(_) => Settings::default(),
    }
}

pub fn save(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}
