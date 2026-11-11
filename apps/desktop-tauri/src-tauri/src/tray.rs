//! The system-tray / macOS menu-bar item: its icon, its click behavior, its wiring.
//!
//! On macOS the item is a menu-bar extra, so a click opens its menu, as every extra does. Windows
//! and Linux follow their tray convention instead: left click reveals the app, right click opens
//! the menu.
//!
//! The tray's MENU CONTENT (and the `recent:<id>` grammar its events parse) lives in
//! `menu.rs` alongside the app menu, which shares that grammar. What is genuinely
//! the tray's own is here: the template-rendered glyph, left-click-reveals, and the
//! best-effort install that must never block startup.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;

use crate::deeplink::{dispatch_deep_link, show_main_window};
use crate::log::logln;
use crate::menu::build_tray_menu;

static TRAY_SCHEDULED: AtomicBool = AtomicBool::new(false);
static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

pub(crate) fn tray_available() -> bool {
    TRAY_AVAILABLE.load(Ordering::Acquire)
}

pub(crate) fn setup_tray_after_ready(app: &AppHandle) {
    if TRAY_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || match setup_tray(&handle) {
        Ok(()) => TRAY_AVAILABLE.store(true, Ordering::Release),
        Err(error) => logln(format!("tray setup failed: {error}")),
    }) {
        TRAY_SCHEDULED.store(false, Ordering::Release);
        logln(format!("tray setup scheduling failed: {error}"));
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = build_tray_menu(app, &[])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Localix")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            // Recent ▸ <session> → focus + open that session by id.
            if let Some(session_id) = id.strip_prefix("recent:") {
                show_main_window(app);
                dispatch_deep_link(app, format!("localix://session/{session_id}"));
                return;
            }
            match id {
                "tray_show" => show_main_window(app),
                "tray_settings" => {
                    show_main_window(app);
                    crate::workspace_windows::open_settings_in_active_view(app);
                }
                "tray_new" => {
                    show_main_window(app);
                    dispatch_deep_link(app, "localix://new".into());
                }
                "tray_quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "macos") {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    // macOS: a menu-bar extra is a template image, black and shaped by its alpha alone, which
    // AppKit tints for a light or dark bar. The glyph is the bird cropped to its ink and drawn at
    // 36 px, exactly 2x the 18 pt `tray-icon` sizes it to, so it is never resampled. The app icon
    // cannot stand in: its opaque plate would template-render as a solid square. Windows and Linux
    // trays show the app icon in colour, which a light or dark taskbar both carry. Both files come
    // from `scripts/app-icons.mjs` and are bundled at compile time.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.icon(tauri::include_image!("icons/64x64.png"));
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    /// On Linux the tray loads libayatana-appindicator3 (or the older libappindicator3) at
    /// runtime, and a missing library is a PANIC inside `libappindicator-sys`, not an `Err` the
    /// best-effort setup above can catch — with `panic = "abort"`, a clean install on a desktop
    /// without it crashed at first paint. The packages must therefore pull the library in.
    #[test]
    fn linux_packages_depend_on_the_library_the_tray_loads() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.linux.conf.json")).expect("valid JSON");
        let depends = |format: &str| -> Vec<String> {
            config["bundle"]["linux"][format]["depends"]
                .as_array()
                .expect("a depends list")
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        };
        assert!(depends("deb")
            .iter()
            .any(|entry| entry.starts_with("libayatana-appindicator3-1")));
        assert!(depends("rpm")
            .iter()
            .any(|entry| entry == "libayatana-appindicator-gtk3"));
    }
}
