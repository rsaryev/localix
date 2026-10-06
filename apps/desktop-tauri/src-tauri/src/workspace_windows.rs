//! Trusted workspace identity, focus, first paint and close lifecycle.
//! Use Window + Webview separately: get_webview_window stops finding a workspace
//! as soon as a native browser child is attached to it.
use std::collections::BTreeMap;
use std::sync::Mutex;
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
        }
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
        let last = self.entries.values().filter(|entry| !entry.closing).count() == 1;
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

pub(crate) fn is_workspace<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    app.state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .contains_key(label)
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
    let labels: Vec<_> = app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .keys()
        .cloned()
        .collect();
    labels
        .iter()
        .filter_map(|label| app.get_webview(label))
        .collect()
}

pub(crate) fn active_view<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<Webview<R>> {
    let views = views(app);
    if let Some(view) = views
        .iter()
        .find(|view| view.window().is_focused().unwrap_or(false))
    {
        return Some(view.clone());
    }
    let last = app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .active
        .clone();
    views
        .iter()
        .find(|view| Some(view.label()) == last.as_deref())
        .cloned()
        .or_else(|| views.into_iter().next())
}

pub(crate) fn active_window<R: tauri::Runtime>(app: &AppHandle<R>) -> Option<Window<R>> {
    active_view(app).map(|view| view.window())
}

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
        let (tx, rx) = std::sync::mpsc::channel();
        crate::macos_tabs::defer(move || {
            let _ = tx.send(open(&app, host, None, None));
        });
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(std::time::Duration::from_secs(10))
                .map_err(|_| "Workspace creation timed out".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
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
    if app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .len()
        >= 64
    {
        return Err("Close a workspace before opening another (64 workspaces maximum)".into());
    }
    let label = match saved_label {
        Some(label) => label,
        None => {
            let mut bytes = [0u8; 8];
            getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
            format!("workspace-{:016x}", u64::from_le_bytes(bytes))
        }
    };
    let script = app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .init_script
        .clone();
    let window = crate::workspace_builder::build(app, &label, route.as_deref(), &script)
        .map_err(|error| error.to_string())?;
    // Register before the first-paint IPC can run; a builder caller is on the main thread.
    register(&window);
    if let Some(entry) = app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .get_mut(&label)
    {
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
    if let Some(entry) = app
        .state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .get_mut(caller.label())
    {
        entry.route = Some(route);
    }
    Ok(())
}

#[cfg(test)]
#[path = "workspace_windows_tests.rs"]
mod tests;
