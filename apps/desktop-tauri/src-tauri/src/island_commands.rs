//! The agent island's page commands. Each validates the calling webview; the page is not trusted.
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, Webview};

use crate::island::{
    collapse, geometry, hide, is_island, place, request_show, show, IslandState, Mode, LABEL,
};

#[tauri::command]
pub(crate) fn island_geometry(
    app: AppHandle,
    caller: Webview,
) -> Result<serde_json::Value, String> {
    if !is_island(&caller) {
        return Err("Only the island can read its geometry".into());
    }
    crate::island_macos::geometry(&app)
}

/// One layout request from the page. Every number is clamped here; the page is not trusted.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IslandLayout {
    expanded: bool,
    height: Option<u64>,
    duration_ms: Option<u64>,
    radius: Option<u64>,
    easing: Option<[f32; 4]>,
    mode: Mode,
}

#[tauri::command]
pub(crate) fn island_set_layout(
    app: AppHandle,
    caller: Webview,
    layout: IslandLayout,
) -> Result<(), String> {
    if !is_island(&caller) {
        return Err("Only the island can resize its island".into());
    }
    let state = app.state::<IslandState>();
    if state.suspended.load(Ordering::Acquire) && layout.expanded {
        collapse(&app);
        return Ok(());
    }
    let (min_radius, max_radius) = geometry::RADIUS_RANGE;
    state.set_mode(layout.mode);
    state
        .expanded_height
        .store(geometry::open_height(layout.height), Ordering::Release);
    state.motion_duration.store(
        layout.duration_ms.unwrap_or(0).min(geometry::MOTION_MAX_MS),
        Ordering::Release,
    );
    *state.motion_easing.lock().unwrap() = layout.easing.filter(|points| {
        points
            .iter()
            .all(|point| point.is_finite() && (0.0..=1.0).contains(point))
    });
    state.corner_radius.store(
        layout
            .radius
            .unwrap_or(geometry::RADIUS_DEFAULT)
            .clamp(min_radius, max_radius),
        Ordering::Release,
    );
    let placed = place(&app, layout.expanded);
    // The hit region follows the mode even when the silhouette is unchanged.
    crate::island_pointer::refresh(&app);
    placed
}

#[tauri::command]
pub(crate) fn island_ready(app: AppHandle, caller: Webview) -> Result<(), String> {
    if !is_island(&caller) {
        return Err("Only the island can reveal itself".into());
    }
    app.state::<IslandState>()
        .ready
        .store(true, Ordering::Release);
    if app.state::<IslandState>().visible.load(Ordering::Acquire) {
        show(&app)?;
    }
    Ok(())
}

/// "Open chat" on the card: show the workspace on the waiting conversation. The request stays
/// pending and the app shows it there.
#[tauri::command]
pub(crate) fn island_open_session(
    app: AppHandle,
    caller: Webview,
    session_id: String,
) -> Result<(), String> {
    if !is_island(&caller) || !crate::island_destination::valid_session_id(&session_id) {
        return Err("Invalid island session destination".into());
    }
    crate::deeplink::show_main_window(&app);
    crate::deeplink::dispatch_deep_link(&app, format!("localix://session/{session_id}"));
    let _ = app.emit_to(LABEL, "island-collapse", ());
    place(&app, false)?;
    Ok(())
}

/// The page holds or releases a portaled menu. Holding widens hit testing to the canvas.
#[tauri::command]
pub(crate) fn island_set_grab(app: AppHandle, caller: Webview, grab: bool) -> Result<(), String> {
    if !is_island(&caller) {
        return Err("Only the island can hold a menu".into());
    }
    app.state::<IslandState>()
        .grabbing
        .store(grab, Ordering::Release);
    crate::island_pointer::refresh(&app);
    Ok(())
}

/// Settings ▸ Agent island. Read by any trusted workspace.
#[tauri::command]
pub(crate) fn island_enabled(app: AppHandle, caller: Webview) -> Result<bool, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    Ok(crate::prefs::island_enabled(&app))
}

/// Turn the island on or off. Off hides it now; the choice survives a relaunch.
#[tauri::command]
pub(crate) fn set_island_enabled(
    app: AppHandle,
    caller: Webview,
    enabled: bool,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    crate::prefs::save_island_enabled(&app, enabled);
    if enabled {
        app.state::<IslandState>()
            .started
            .store(true, Ordering::Release);
        request_show(&app);
    } else {
        hide(&app);
    }
    Ok(())
}

/// Whether a Localix workspace window is the key window, so the island leaves requests to it.
fn workspace_focused(app: &AppHandle) -> bool {
    crate::workspace_windows::views(app)
        .iter()
        .any(|view| view.window().is_focused().unwrap_or(false))
}

/// A workspace gained or lost focus. Deferred so a switch between two workspaces settles first.
pub(crate) fn workspace_focus_changed(app: &AppHandle) {
    let handle = app.clone();
    crate::main_queue::defer(move || {
        let _ = handle.emit_to(LABEL, "island-workspace-focus", workspace_focused(&handle));
    });
}

#[tauri::command]
pub(crate) fn island_workspace_focus(app: AppHandle, caller: Webview) -> Result<bool, String> {
    if !is_island(&caller) {
        return Err("Only the island reads workspace focus".into());
    }
    Ok(workspace_focused(&app))
}
