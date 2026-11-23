//! Scync Desktop — Tauri 2 shell.
//!
//! Rust owns only what a webview cannot: the Google loopback OAuth server,
//! clipboard write-then-clear, tray, global shortcut, single instance, and
//! window lifecycle. All crypto and all Firestore access live in the webview
//! (vendored TypeScript backend); the vault key never leaves the main
//! window's JS memory.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod oauth;
mod settings;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

pub const MAIN_WINDOW: &str = "main";
pub const QUICK_WINDOW: &str = "quick";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: recreate (if destroyed), then focus the main window.
            commands::ensure_main_window(app);
            if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        commands::toggle_quick(app.clone());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::google_sign_in,
            commands::copy_secret,
            commands::load_settings,
            commands::save_settings,
            commands::register_hotkey,
            commands::show_main_window,
            commands::hide_quick_window,
            commands::toggle_autostart,
            commands::is_autostart_enabled,
            commands::get_hotkey,
            commands::quit_app,
            commands::open_external,
        ])
        .setup(|app| {
            let settings = settings::load(app.handle());

            // Quick-search popup window: frameless, transparent, always on
            // top, skip taskbar. Created hidden; toggled by the hotkey or tray.
            let quick = WebviewWindowBuilder::new(
                app,
                QUICK_WINDOW,
                tauri::WebviewUrl::App("quick.html".into()),
            )
            .title("Scync Quick Search")
            .inner_size(640.0, 540.0)
            .visible(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .build()?;

            // Hide the popup when it loses focus (click elsewhere).
            {
                let quick_w = quick.clone();
                quick.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        let _ = quick_w.hide();
                    }
                });
            }

            // Tray with a menu mirroring the spec (section 3.5).
            let open_item = MenuItem::with_id(app, "open", "Open Scync", true, None::<&str>)?;
            let quick_item = MenuItem::with_id(app, "quick", "Quick Search", true, None::<&str>)?;
            let lock_item = MenuItem::with_id(app, "lock", "Lock now", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Scync", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &open_item,
                    &quick_item,
                    &lock_item,
                    &PredefinedMenuItem::separator(app)?,
                    &quit_item,
                ],
            )?;

            TrayIconBuilder::with_id("scync-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Scync")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => { let _ = commands::show_main_window(app.clone()); }
                    "quick" => { let _ = commands::toggle_quick(app.clone()); }
                    "lock" => {
                        let _ = app.emit_to(MAIN_WINDOW, "tray:lock", ());
                    }
                    "quit" => { let _ = commands::quit_app(app.clone()); }
                    _ => {}
                })
                .build(app)?;

            // Register the configured hotkey; tolerate failure (conflict).
            let (shortcut, conflict) = commands::register_shortcut(app.handle(), &settings.hotkey);
            if conflict {
                eprintln!("global shortcut '{shortcut}' could not be registered (already taken?).");
            }

            // Best-effort screenshot/recording protection (setting, default on).
            if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
                let _ = main.set_content_protected(settings.content_protection);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window only hides it; the process stays in the
            // tray so the global hotkey keeps working. Quit via tray / Cmd+Q.
            if window.label() == MAIN_WINDOW {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Scync");
}
