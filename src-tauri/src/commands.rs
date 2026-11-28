//! Tauri commands exposed to the webviews, plus shared internals.

use crate::biometric;
use crate::oauth;
use crate::settings::{self, Settings};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::{VaultLockState, MAIN_WINDOW, QUICK_WINDOW};

// ─── Google sign-in (loopback flow in Rust, sign-in completion in the webview) ───

/// Run the Google loopback OAuth flow and return `{ idToken, accessToken }`.
/// The webview then completes sign-in via `signInWithCredential`.
#[tauri::command]
pub async fn google_sign_in(client_id: String, client_secret: String) -> Result<oauth::OAuthTokens, String> {
    if client_id.is_empty() {
        return Err("Google sign-in is not configured. Set up email/password sign-in or build with SCYNC_GOOGLE_CLIENT_ID.".into());
    }
    // The loopback server is synchronous; run it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        oauth::run_loopback_sign_in(&client_id, &client_secret, 180) // 3 min timeout
    })
    .await
    .map_err(|e| format!("sign-in task failed: {e}"))?
}

// ─── Clipboard with auto-clear ───

/// SHA-256 of arbitrary text, hex encoded.
fn text_hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect::<String>()
}

/// Write `text` to the system clipboard and schedule a clear after
/// `clear_after_secs` — but only if the clipboard still holds our value.
#[tauri::command]
pub fn copy_secret(text: String, clear_after_secs: Option<u64>) -> Result<(), String> {
    copy_with_auto_clear(&text, clear_after_secs.unwrap_or(20))
}

pub fn copy_with_auto_clear(text: &str, clear_after_secs: u64) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())?;

    if clear_after_secs == 0 {
        return Ok(());
    }

    let ours = text_hash(text);
    let secs = clear_after_secs;
    let text_owned = text.to_string();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(secs));
        // Clear only if the clipboard still holds our value (compare a hash).
        match arboard::Clipboard::new().and_then(|mut c| c.get_text()) {
            Ok(current) if text_hash(&current) == ours => {
                if let Err(e) = arboard::Clipboard::new().and_then(|mut c| c.clear()) {
                    // Fallback: overwrite with empty text if clear is unsupported.
                    let _ = e;
                    if let Ok(mut c) = arboard::Clipboard::new() {
                        let _ = c.set_text(String::new());
                    }
                }
            }
            _ => {
                // Clipboard changed in the meantime — nothing to clear.
                let _ = &text_owned;
            }
        }
    });

    Ok(())
}

// ─── Quick-search popup ───

/// Toggle the quick-search popup on the monitor under the cursor.
/// Creates the popup lazily on first use, and ensures the main window exists
/// (hidden) if it was destroyed while locked in the tray.
pub fn toggle_quick(app: AppHandle) {
    ensure_main_window_hidden(&app);
    let quick = match ensure_quick_window(&app) {
        Some(w) => w,
        None => return,
    };

    if quick.is_visible().unwrap_or(false) {
        let _ = quick.hide();
        return;
    }

    // Position centred-ish on the monitor under the cursor.
    if let Some(pos) = app.cursor_position().ok() {
        let monitors = app.available_monitors().unwrap_or_default();
        let target = monitors.into_iter().find(|m| {
            let mp = m.position();
            let ms = m.size();
            pos.x >= mp.x as f64
                && pos.x < mp.x as f64 + ms.width as f64
                && pos.y >= mp.y as f64
                && pos.y < mp.y as f64 + ms.height as f64
        });

        if let Some(m) = target {
            let mp = m.position();
            let ms = m.size();
            let window_w = 640.0;
            let window_h = 540.0;
            let scale = m.scale_factor();
            let x = mp.x as f64 + (ms.width as f64 / scale - window_w) / 2.0;
            let y = mp.y as f64 + (ms.height as f64 / scale - window_h) * 0.3;
            let _ = quick.set_position(tauri::PhysicalPosition::new(x.max(0.0), y.max(0.0)));
        }
    }

    let _ = quick.show();
    let _ = quick.set_focus();
    let _ = quick.emit("quick:shown", ());
}

/// Hide/destroy the quick popup (called by the popup itself on Esc / after copy).
/// Destroying frees its WebView2 renderer memory immediately when not in use.
#[tauri::command]
pub fn hide_quick_window(app: AppHandle) -> Result<(), String> {
    if let Some(quick) = app.get_webview_window(QUICK_WINDOW) {
        quick.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show and focus the main window (tray "Open", popup "Unlock" action).
#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    ensure_main_window(&app);
    show_main(&app);
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ─── Hotkey management ───

/// Register `accelerator` as the global hotkey, replacing any previous one.
/// Returns Ok(true) if registered, Ok(false) if the accelerator is invalid,
/// and an Err if registration failed (e.g. already taken). On failure the
/// previous binding is restored, so a bad attempt never leaves the app with
/// no shortcut at all.
#[tauri::command]
pub fn register_hotkey(app: AppHandle, accelerator: String) -> Result<bool, String> {
    // Parse before touching the live binding: an invalid string must never
    // tear down a shortcut that currently works.
    let shortcut = accelerator
        .parse::<Shortcut>()
        .map_err(|_| format!("'{accelerator}' is not a valid shortcut."))?;

    let previous = settings::load(&app).hotkey;
    let gs = app.global_shortcut();

    // Release the current binding so the new one can take it.
    let _ = gs.unregister_all();

    match gs.register(shortcut) {
        Ok(()) => {
            let mut settings = settings::load(&app);
            settings.hotkey = accelerator;
            settings::save(&app, &settings).map_err(|e| e.to_string())?;
            Ok(true)
        }
        Err(_) => {
            // Restore the previous binding so the popup keeps working.
            let _ = register_shortcut(&app, &previous);
            Err(format!("'{accelerator}' is taken by another app. Pick another shortcut."))
        }
    }
}

/// The current hotkey (settings value, falling back to the default).
#[tauri::command]
pub fn get_hotkey(app: AppHandle) -> String {
    settings::load(&app).hotkey
}

/// Register a shortcut (after unregistering ours). Returns (accelerator, conflict?).
pub fn register_shortcut(app: &AppHandle, accelerator: &str) -> (String, bool) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    match accelerator.parse::<Shortcut>() {
        Ok(shortcut) => match gs.register(shortcut) {
            Ok(()) => (accelerator.to_string(), false),
            Err(_) => (accelerator.to_string(), true),
        },
        Err(_) => (accelerator.to_string(), true),
    }
}

// ─── Settings persistence ───

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Settings {
    settings::load(&app)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings_data: Settings) -> Result<(), String> {
    settings::save(&app, &settings_data)?;
    // Apply content protection live.
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.set_content_protected(settings_data.content_protection);
    }
    Ok(())
}

// ─── Autostart (opt-in, default off) ───

#[tauri::command]
pub fn is_autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn toggle_autostart(app: AppHandle, enable: bool) -> Result<(), String> {
    let autostart = app.autolaunch();
    if enable {
        autostart.enable().map_err(|e| e.to_string())
    } else {
        autostart.disable().map_err(|e| e.to_string())
    }
}

// ─── Lifecycle ───

/// Quit the whole app (tray menu / Cmd+Q equivalent in the UI).
#[tauri::command]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Open a URL in the system browser. Only http(s) is accepted so a stray
/// link can never hand the OS a local-file or custom-scheme target.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only http(s) links can be opened externally".into());
    }
    open::that(trimmed).map_err(|e| e.to_string())
}

/// Recreate the main webview window (used to reopen the main window if destroyed).
pub fn ensure_main_window(app: &AppHandle) {
    if app.get_webview_window(MAIN_WINDOW).is_none() {
        let content_protection = settings::load(app).content_protection;
        if let Ok(win) = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
            .title("Scync")
            .inner_size(1200.0, 800.0)
            .min_inner_size(960.0, 640.0)
            .center()
            .build()
        {
            let _ = win.set_content_protected(content_protection);
        }
    }
}

/// Recreate the main webview window hidden (when quick search needs it while locked).
pub fn ensure_main_window_hidden(app: &AppHandle) {
    if app.get_webview_window(MAIN_WINDOW).is_none() {
        let content_protection = settings::load(app).content_protection;
        if let Ok(win) = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::App("index.html".into()))
            .title("Scync")
            .inner_size(1200.0, 800.0)
            .min_inner_size(960.0, 640.0)
            .visible(false)
            .build()
        {
            let _ = win.set_content_protected(content_protection);
        }
    }
}

/// Create the quick-search popup window lazily on demand.
pub fn ensure_quick_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(QUICK_WINDOW) {
        return Some(w);
    }
    WebviewWindowBuilder::new(app, QUICK_WINDOW, WebviewUrl::App("quick.html".into()))
        .title("Scync Quick Search")
        .inner_size(640.0, 540.0)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
        .ok()
}

/// Destroy the main window when it is hidden and locked, freeing its WebView2
/// renderer memory while keeping the lightweight Rust tray/hotkey process alive.
#[tauri::command]
pub fn destroy_main_if_hidden(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
        if !win.is_visible().unwrap_or(true) {
            let _ = win.destroy();
        }
    }
    Ok(())
}

/// Sync the vault lock state to Rust so CloseRequested knows whether to hide
/// (when unlocked) or destroy the WebView2 immediately (when locked).
#[tauri::command]
pub fn set_vault_unlocked(state: State<'_, VaultLockState>, unlocked: bool) {
    state.0.store(unlocked, Ordering::Relaxed);
}

// ─── Windows Hello / Biometric unlock ───

#[tauri::command]
pub async fn is_biometric_available() -> bool {
    tauri::async_runtime::spawn_blocking(biometric::is_available)
        .await
        .unwrap_or(false)
}

#[tauri::command]
pub fn has_biometric_enrolled(app: AppHandle, uid: String) -> bool {
    biometric::has_enrolled_key(&app, &uid)
}

#[tauri::command]
pub async fn enroll_biometric(app: AppHandle, uid: String, password: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || biometric::enroll(&app, &uid, &password))
        .await
        .map_err(|e| format!("Windows Hello task failed: {e}"))?
}

#[tauri::command]
pub async fn unlock_with_biometric(app: AppHandle, uid: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || biometric::unlock(&app, &uid))
        .await
        .map_err(|e| format!("Windows Hello task failed: {e}"))?
}

#[tauri::command]
pub fn clear_biometric(app: AppHandle, uid: String) -> Result<(), String> {
    biometric::clear_enrolled_key(&app, &uid)
}
