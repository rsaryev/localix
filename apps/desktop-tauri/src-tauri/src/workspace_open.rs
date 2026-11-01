//! Opening a workspace window: its label, its registry entry, and the first build.

use crate::workspace_windows::{register, workspaces, Workspace};
use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
pub(crate) fn open(
    app: &AppHandle,
    host: Option<String>,
    route: Option<String>,
    saved_label: Option<String>,
) -> Result<String, String> {
    open_with_mode(app, host, route, saved_label, false, false)
}

#[cfg(target_os = "macos")]
pub(crate) fn new_label() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(format!("workspace-{:016x}", u64::from_le_bytes(bytes)))
}

#[cfg(target_os = "macos")]
pub(crate) fn open_provisional(
    app: &AppHandle,
    label: String,
    route: String,
) -> Result<String, String> {
    open_with_mode(app, None, Some(route), Some(label), true, false)
}

#[cfg(target_os = "macos")]
pub(crate) fn open_restored(
    app: &AppHandle,
    host: Option<String>,
    route: Option<String>,
    label: String,
    hidden: bool,
) -> Result<String, String> {
    open_with_mode(app, host, route, Some(label), false, hidden)
}

#[cfg(target_os = "macos")]
fn open_with_mode(
    app: &AppHandle,
    host: Option<String>,
    route: Option<String>,
    saved_label: Option<String>,
    provisional: bool,
    hidden: bool,
) -> Result<String, String> {
    if workspaces(app).entries.len() >= crate::workspace_session_model::MAX_WORKSPACES {
        return Err(format!(
            "Close a workspace before opening another ({} workspaces maximum)",
            crate::workspace_session_model::MAX_WORKSPACES
        ));
    }
    let label = match saved_label {
        Some(label) => label,
        None => new_label()?,
    };
    let script = workspaces(app).init_script.clone();
    if provisional || hidden {
        workspaces(app).entries.insert(
            label.clone(),
            Workspace {
                route: route.clone(),
                provisional,
                hidden,
                transfer_pending: provisional,
                ..Workspace::default()
            },
        );
    }
    let window = match crate::workspace_builder::build(app, &label, route.as_deref(), &script) {
        Ok(window) => window,
        Err(error) => {
            if provisional || hidden {
                workspaces(app).entries.remove(&label);
            }
            return Err(error.to_string());
        }
    };
    // Register before the first-paint IPC can run; a builder caller is on the main thread.
    register(&window);
    if let Some(entry) = workspaces(app).entries.get_mut(&label) {
        entry.route = route;
        entry.host = host;
    }
    let zoom = *app.state::<crate::prefs::ZoomState>().0.lock().unwrap();
    let _ = window.set_zoom(zoom);
    Ok(label)
}
