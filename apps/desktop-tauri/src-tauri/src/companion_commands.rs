//! The agent island's page commands. Each validates the calling webview; the page is not trusted.
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, Webview};

use crate::companion::{
    activate_when_ready, collapse, geometry, hide, is_companion, place, request_show, show,
    CompanionState, LABEL,
};

#[tauri::command]
pub(crate) fn companion_geometry(
    app: AppHandle,
    caller: Webview,
) -> Result<serde_json::Value, String> {
    if !is_companion(&caller) {
        return Err("Only the companion can read its geometry".into());
    }
    crate::companion_macos::geometry(&app)
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
    #[serde(default)]
    quiet: bool,
}

#[tauri::command]
pub(crate) fn companion_set_expanded(
    app: AppHandle,
    caller: Webview,
    layout: IslandLayout,
) -> Result<(), String> {
    if !is_companion(&caller) {
        return Err("Only the companion can resize its island".into());
    }
    let state = app.state::<CompanionState>();
    if state.suspended.load(Ordering::Acquire) && layout.expanded {
        collapse(&app);
        return Ok(());
    }
    let (min_radius, max_radius) = geometry::RADIUS_RANGE;
    state.quiet.store(layout.quiet, Ordering::Release);
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
    place(&app, layout.expanded)
}

#[tauri::command]
pub(crate) fn companion_ready(app: AppHandle, caller: Webview) -> Result<(), String> {
    if !is_companion(&caller) {
        return Err("Only the companion can reveal itself".into());
    }
    app.state::<CompanionState>()
        .ready
        .store(true, Ordering::Release);
    if app
        .state::<CompanionState>()
        .visible
        .load(Ordering::Acquire)
    {
        show(&app)?;
        activate_when_ready(&app);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn companion_open_session(
    app: AppHandle,
    caller: Webview,
    session_id: String,
) -> Result<(), String> {
    if !is_companion(&caller) || !crate::companion_destination::valid_session_id(&session_id) {
        return Err("Invalid companion session destination".into());
    }
    crate::deeplink::show_main_window(&app);
    crate::deeplink::dispatch_deep_link(&app, format!("localix://session/{session_id}"));
    let _ = app.emit_to(LABEL, "companion-collapse", ());
    place(&app, false)?;
    Ok(())
}

/// The page holds or releases the size handle. Holding widens hit testing to the canvas.
#[tauri::command]
pub(crate) fn companion_set_grab(
    app: AppHandle,
    caller: Webview,
    grab: bool,
) -> Result<(), String> {
    if !is_companion(&caller) {
        return Err("Only the companion can hold its size handle".into());
    }
    app.state::<CompanionState>()
        .grabbing
        .store(grab, Ordering::Release);
    crate::companion_pointer::refresh(&app);
    Ok(())
}

/// Settings ▸ Agent island. Read by any trusted workspace.
#[tauri::command]
pub(crate) fn island_enabled(app: AppHandle, caller: Webview) -> Result<bool, String> {
    crate::workspace_windows::require_workspace(&caller)?;
    Ok(crate::prefs::island_enabled(&app))
}

/// Turn the island on or off. Off hides it now, ignores the shortcut and removes Quick Chat from
/// the menu-bar menu; the choice survives a relaunch.
#[tauri::command]
pub(crate) fn set_island_enabled(
    app: AppHandle,
    caller: Webview,
    enabled: bool,
) -> Result<(), String> {
    crate::workspace_windows::require_workspace(&caller)?;
    crate::prefs::save_island_enabled(&app, enabled);
    if enabled {
        app.state::<CompanionState>()
            .started
            .store(true, Ordering::Release);
        request_show(&app);
    } else {
        hide(&app);
    }
    crate::menu::rebuild_menus(&app);
    Ok(())
}

/// Whether a Localix workspace window is the key window, so the island leaves attention to it.
fn workspace_focused(app: &AppHandle) -> bool {
    crate::workspace_windows::views(app)
        .iter()
        .any(|view| view.window().is_focused().unwrap_or(false))
}

/// A workspace gained or lost focus. Deferred so a switch between two workspaces settles first.
pub(crate) fn workspace_focus_changed(app: &AppHandle) {
    let handle = app.clone();
    crate::main_queue::defer(move || {
        let _ = handle.emit_to(
            LABEL,
            "companion-workspace-focus",
            workspace_focused(&handle),
        );
    });
}

#[tauri::command]
pub(crate) fn companion_workspace_focus(app: AppHandle, caller: Webview) -> Result<bool, String> {
    if !is_companion(&caller) {
        return Err("Only the companion reads workspace focus".into());
    }
    Ok(workspace_focused(&app))
}
