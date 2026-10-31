//! The island is macOS-only. Keep the IPC contract harmless on other desktop platforms.
use tauri::{AppHandle, Webview};

pub(crate) const LABEL: &str = "island";
const UNAVAILABLE: &str = "The agent island is available only on macOS";

#[derive(Default)]
pub(crate) struct IslandState {}

pub(crate) fn start_once(_: &AppHandle) {}
pub(crate) fn is_island(_: &Webview) -> bool {
    false
}

#[tauri::command]
pub(crate) fn island_enabled(app: AppHandle, caller: Webview) -> Result<bool, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    let _ = app;
    Ok(false)
}

#[tauri::command]
pub(crate) fn set_island_enabled(
    app: AppHandle,
    caller: Webview,
    enabled: bool,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    let _ = (app, enabled);
    Ok(())
}

#[tauri::command]
pub(crate) fn island_ready(app: AppHandle, caller: Webview) -> Result<(), String> {
    let _ = (app, caller);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) fn island_geometry(
    app: AppHandle,
    caller: Webview,
) -> Result<serde_json::Value, String> {
    let _ = (app, caller);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) fn island_set_layout(
    app: AppHandle,
    caller: Webview,
    layout: serde_json::Value,
) -> Result<(), String> {
    let _ = (app, caller, layout);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) fn island_set_grab(app: AppHandle, caller: Webview, grab: bool) -> Result<(), String> {
    let _ = (app, caller, grab);
    Err(UNAVAILABLE.into())
}

#[tauri::command]
pub(crate) fn island_open_session(
    app: AppHandle,
    caller: Webview,
    session_id: String,
) -> Result<(), String> {
    let _ = (app, caller, session_id);
    Err(UNAVAILABLE.into())
}

pub(crate) fn workspace_focus_changed(_: &AppHandle) {}

#[tauri::command]
pub(crate) fn island_workspace_focus(app: AppHandle, caller: Webview) -> Result<bool, String> {
    let _ = (app, caller);
    Err(UNAVAILABLE.into())
}
