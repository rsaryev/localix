//! Persisted shell preferences: webview zoom and the resolved theme.
//!
//! This module owns WHERE these live (two plain files in the app config dir),
//! WHAT their on-disk format is (a bare float; the strings "dark"/"light"), and
//! the zoom clamp range. No caller needs to know any of that — they ask for
//! `load_zoom(app)` or nudge the zoom by a menu id and get the invariants for free.

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

/// Current webview zoom factor (View ▸ Zoom In/Out/Actual Size).
pub(crate) struct ZoomState(pub(crate) Mutex<f64>);
impl Default for ZoomState {
    fn default() -> Self {
        Self(Mutex::new(1.0))
    }
}

const ZOOM_MIN: f64 = 0.5;
const ZOOM_MAX: f64 = 3.0;
const ZOOM_STEP: f64 = 0.1;

/// Path of the persisted zoom factor (a single float in the app config dir).
fn zoom_file<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("zoom"))
}

/// Persist the current zoom so it survives a relaunch (native apps remember it).
fn save_zoom<R: tauri::Runtime>(app: &AppHandle<R>, zoom: f64) {
    if let Some(path) = zoom_file(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, zoom.to_string());
    }
}

/// Load the persisted zoom (clamped), or 1.0 when unset/unreadable.
pub(crate) fn load_zoom<R: tauri::Runtime>(app: &AppHandle<R>) -> f64 {
    zoom_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|z| z.clamp(ZOOM_MIN, ZOOM_MAX))
        .unwrap_or(1.0)
}

/// Is `id` one of the View ▸ zoom menu items?
pub(crate) fn is_zoom_menu_id(id: &str) -> bool {
    matches!(id, "zoom_in" | "zoom_out" | "zoom_reset")
}

/// Apply a View ▸ zoom menu command: step the factor (clamped), push it to the
/// webview, and persist it. The step size and clamp range stay in here — the menu
/// dispatcher only knows the item's id.
pub(crate) fn apply_zoom_menu<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) {
    let state = app.state::<ZoomState>();
    let mut zoom = state.0.lock().unwrap();
    *zoom = match id {
        "zoom_in" => (*zoom + ZOOM_STEP).min(ZOOM_MAX),
        "zoom_out" => (*zoom - ZOOM_STEP).max(ZOOM_MIN),
        _ => 1.0,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_zoom(*zoom);
    }
    save_zoom(app, *zoom);
}

/// Restore the persisted zoom into both the managed state and the live webview.
pub(crate) fn restore_zoom<R: tauri::Runtime>(app: &AppHandle<R>) {
    let zoom = load_zoom(app);
    *app.state::<ZoomState>().0.lock().unwrap() = zoom;
    if (zoom - 1.0).abs() > f64::EPSILON {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_zoom(zoom);
        }
    }
}

fn theme_file<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("theme"))
}

/// Persist the app's resolved theme ("dark"/"light") so the NEXT launch paints the
/// matching window background before the UI loads — no wrong-colour flash even when
/// the user forces a theme opposite to the OS. `None` (system) removes the file so
/// startup follows the OS theme instead.
pub(crate) fn save_theme<R: tauri::Runtime>(app: &AppHandle<R>, resolved: Option<&str>) {
    if let Some(path) = theme_file(app) {
        match resolved {
            Some(t) => {
                if let Some(dir) = path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::write(path, t);
            }
            None => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// The persisted resolved theme: `Some(true)` dark, `Some(false)` light, `None` unset.
pub(crate) fn load_theme_is_dark<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<bool> {
    theme_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| match s.trim() {
            "dark" => Some(true),
            "light" => Some(false),
            _ => None,
        })
}
