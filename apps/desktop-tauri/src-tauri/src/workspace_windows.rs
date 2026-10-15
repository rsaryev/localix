//! Trusted workspace identity, focus, first paint and close lifecycle.
//! Use Window + Webview separately: get_webview_window stops finding a workspace
//! as soon as a native browser child is attached to it.
use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Manager, Webview, Window};

#[derive(Clone)]
pub(crate) struct Workspace {
    pub(crate) route: Option<String>,
    pub(crate) ready: bool,
    pub(crate) closing: bool,
    pub(crate) hiding: bool,
    pub(crate) host: Option<String>,
    pub(crate) revealed: bool,
    pub(crate) focus_on_reveal: bool,
    pub(crate) select_on_reveal: bool,
    pub(crate) restore_frame: Option<[f64; 4]>,
    pub(crate) restore_fullscreen: bool,
    pub(crate) provisional: bool,
    pub(crate) hidden: bool,
    pub(crate) transfer_presented: bool,
    pub(crate) transfer_pending: bool,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            route: None,
            ready: false,
            closing: false,
            hiding: false,
            host: None,
            revealed: false,
            focus_on_reveal: true,
            select_on_reveal: true,
            restore_frame: None,
            restore_fullscreen: false,
            provisional: false,
            hidden: false,
            transfer_presented: false,
            transfer_pending: false,
        }
    }
}

impl Workspace {
    pub(crate) fn allows_reveal(&self) -> bool {
        self.ready && !self.revealed && !self.provisional && !self.hidden && !self.transfer_pending
    }
}

pub(crate) use crate::workspace_lifecycle::{register, reveal};

#[derive(Default)]
pub(crate) struct WindowData {
    pub(crate) entries: BTreeMap<String, Workspace>,
    pub(crate) active: Option<String>,
    pub(crate) init_script: String,
    #[cfg(target_os = "macos")]
    pub(crate) hidden_groups: Vec<crate::workspace_session_model::SavedGroup>,
}

impl WindowData {
    #[cfg(target_os = "macos")]
    pub(crate) fn reserve_hide(&mut self, labels: &[String]) -> bool {
        if labels.is_empty()
            || labels.iter().any(|label| {
                self.entries
                    .get(label)
                    .is_none_or(|entry| entry.closing || entry.hiding)
            })
        {
            return false;
        }
        for label in labels {
            self.entries.get_mut(label).unwrap().hiding = true;
        }
        true
    }

    pub(crate) fn reserve_close(&mut self, label: &str) -> Option<bool> {
        let last = self
            .entries
            .values()
            .filter(|entry| !entry.closing && !entry.provisional)
            .count()
            == 1;
        let entry = self.entries.get_mut(label)?;
        if entry.closing || entry.hiding {
            return None;
        }
        entry.closing = true;
        Some(last)
    }
}

#[derive(Default)]
pub(crate) struct WorkspaceWindows(pub(crate) Mutex<WindowData>);

impl WorkspaceWindows {
    pub(crate) fn set_init_script(&self, script: String) {
        self.0.lock().unwrap().init_script = script;
    }
}

/// Locks the workspace registry. Keep the guard short: never hold it across a main-thread
/// round trip or a window call that can re-enter a workspace event handler.
pub(crate) fn workspaces<R: tauri::Runtime, M: Manager<R>>(
    manager: &M,
) -> MutexGuard<'_, WindowData> {
    manager
        .state::<WorkspaceWindows>()
        .inner()
        .0
        .lock()
        .unwrap()
}

pub(crate) fn is_workspace<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    workspaces(app).entries.contains_key(label)
}

pub(crate) fn require_workspace(caller: &Webview) -> Result<(), String> {
    if caller.label() == caller.window().label()
        && is_workspace(caller.app_handle(), caller.label())
    {
        Ok(())
    } else {
        Err("Only a trusted Localix workspace can use this command".into())
    }
}

pub(crate) fn views<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<Webview<R>> {
    let labels: Vec<_> = workspaces(app).entries.keys().cloned().collect();
    labels
        .iter()
        .filter_map(|label| app.get_webview(label))
        .collect()
}

/// Settings… (menu and tray) drives the UI's inspector settings panel, which has no URL route.
pub(crate) fn open_settings_in_active_view<R: tauri::Runtime>(app: &AppHandle<R>) {
    if let Some(view) = active_view(app) {
        let _ = view.eval("window.__localixOpenSettings && window.__localixOpenSettings()");
    }
}

pub(crate) fn active_view<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<Webview<R>> {
    let views: Vec<_> = views(app)
        .into_iter()
        .filter(|view| {
            workspaces(app)
                .entries
                .get(view.label())
                .is_some_and(|entry| !entry.provisional)
        })
        .collect();
    if let Some(view) = views
        .iter()
        .find(|view| view.window().is_focused().unwrap_or(false))
    {
        return Some(view.clone());
    }
    let last = workspaces(app).active.clone();
    views
        .iter()
        .find(|view| Some(view.label()) == last.as_deref())
        .cloned()
        .or_else(|| views.into_iter().next())
}

pub(crate) fn active_window<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    active_view(app).map(|view| view.window())
}

/// How long `workspace_open` waits for the main thread to build a window. Building one loads a
/// webview, which can take a few seconds on a cold start; ten leaves headroom without hanging the
/// caller on a wedged main thread.
#[cfg(target_os = "macos")]
const OPEN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[tauri::command]
pub(crate) async fn workspace_open(
    app: AppHandle,
    caller: Webview,
    as_tab: bool,
) -> Result<String, String> {
    require_workspace(&caller)?;
    #[cfg(target_os = "macos")]
    {
        let host = as_tab.then(|| caller.label().to_string());
        crate::round_trip::run_on_main(OPEN_TIMEOUT, "Workspace creation timed out", move || {
            open(&app, host, None, None)
        })
        .await?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, as_tab);
        Err("Native workspace windows are available on macOS".into())
    }
}

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
    if workspaces(app).entries.len() >= 64 {
        return Err("Close a workspace before opening another (64 workspaces maximum)".into());
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

#[tauri::command]
pub(crate) fn workspace_location(
    app: AppHandle,
    caller: Webview,
    route: String,
) -> Result<(), String> {
    require_workspace(&caller)?;
    if !crate::workspace_session::valid_route(&route) {
        return Err("Invalid workspace route".into());
    }
    let changed = workspaces(&app)
        .entries
        .get_mut(caller.label())
        .is_some_and(|entry| {
            let changed = entry.route.as_deref() != Some(route.as_str());
            entry.route = Some(route);
            changed
        });
    // Written now, not only at quit: a crash, a force quit or a dev rebuild never reaches the
    // quit-time save, and the next launch would reopen a stale route.
    #[cfg(target_os = "macos")]
    if changed {
        crate::workspace_session::save_soon(&app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = changed;
    Ok(())
}

#[cfg(test)]
#[path = "workspace_windows_tests.rs"]
mod tests;
