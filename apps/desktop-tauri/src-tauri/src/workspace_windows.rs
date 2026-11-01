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
    /// When the group was ordered out; AppKit's own follow-up focus is not a reopen.
    pub(crate) hidden_at: Option<std::time::Instant>,
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
            hidden_at: None,
            transfer_presented: false,
            transfer_pending: false,
        }
    }
}

/// AppKit selects and focuses a sibling of a tab it just ordered out. A focus this soon after
/// the hide is that echo, not a person reopening the group from the Window menu.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) const HIDE_FOCUS_ECHO: std::time::Duration = std::time::Duration::from_millis(500);

impl Workspace {
    /// A focus event on this hidden workspace can be a deliberate reopen.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn focus_can_reopen(&self) -> bool {
        !self.hiding
            && self
                .hidden_at
                .is_none_or(|hidden_at| hidden_at.elapsed() >= HIDE_FOCUS_ECHO)
    }

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
    /// A plugin app started this launch (`--background`): workspaces get ready without showing
    /// until something asks for Localix itself. Never saved, so the next launch shows as usual.
    pub(crate) held: bool,
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

    /// Whether a workspace outside `labels` stays on screen. Closing a group then destroys it:
    /// retaining it hidden only pays off as the Dock-reopen target of the last visible group.
    #[cfg(target_os = "macos")]
    pub(crate) fn other_group_visible(&self, labels: &[String]) -> bool {
        self.entries.iter().any(|(label, entry)| {
            !labels.contains(label)
                && !entry.hidden
                && !entry.hiding
                && !entry.closing
                && !entry.provisional
        })
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
pub(crate) use crate::workspace_open::{new_label, open, open_provisional, open_restored};

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
