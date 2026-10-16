//! macOS snapshot/restore; model validation is shared with deterministic tests.
pub(crate) use crate::workspace_session_model::valid_route;
#[cfg(target_os = "macos")]
use crate::workspace_session_model::{SavedGroup, SavedSession, SavedWorkspace};

/// Coalesces a burst of route changes into one session write.
#[cfg(target_os = "macos")]
const SAVE_DEBOUNCE: std::time::Duration = std::time::Duration::from_millis(400);
/// Capturing the session reads every window frame on the main thread; a save gives up rather than
/// block quit or a later save behind a wedged main thread.
#[cfg(target_os = "macos")]
const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(target_os = "macos")]
fn session_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|path| path.join("workspace-windows.json"))
}

#[cfg(target_os = "macos")]
pub(crate) fn load(app: &tauri::AppHandle) -> SavedSession {
    session_path(app)
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| crate::workspace_session_model::decode_session(&bytes))
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub(crate) fn snapshot<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> SavedSession {
    use objc2_app_kit::{NSWindow, NSWindowStyleMask};
    use tauri::Manager;
    let (records, hidden) = {
        let data = crate::workspace_windows::workspaces(app);
        (data.entries.clone(), data.hidden_groups.clone())
    };
    let windows: std::collections::HashMap<usize, _> = records
        .iter()
        .filter(|(_, entry)| !entry.provisional)
        .map(|(label, _)| label)
        .filter_map(|label| {
            let ptr = app.get_window(label)?.ns_window().ok()? as usize;
            Some((ptr, label.clone()))
        })
        .collect();
    let mut session = SavedSession::default();
    let mut seen = std::collections::HashSet::new();
    for (ptr, label) in &windows {
        if seen.contains(ptr) {
            continue;
        }
        let native = unsafe { &*(*ptr as *const NSWindow) };
        let group = native.tabGroup();
        let ordered = group
            .as_ref()
            .map(|group| {
                group
                    .windows()
                    .iter()
                    .map(|window| (&*window as *const NSWindow) as usize)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec![*ptr]);
        let selected = group
            .as_ref()
            .and_then(|group| group.selectedWindow())
            .map(|window| (&*window as *const NSWindow) as usize)
            .unwrap_or(*ptr);
        let fullscreen = native.styleMask().contains(NSWindowStyleMask::FullScreen);
        let bounds = native.frame();
        let mut saved = SavedGroup {
            tabs: Vec::new(),
            selected: 0,
            frame: (!fullscreen && !native.isMiniaturized()).then_some([
                bounds.origin.x,
                bounds.origin.y,
                bounds.size.width,
                bounds.size.height,
            ]),
            fullscreen,
            hidden: records[label].hidden,
        };
        for member in ordered {
            if !seen.insert(member) {
                continue;
            }
            let Some(label) = windows.get(&member) else {
                continue;
            };
            if member == selected {
                saved.selected = saved.tabs.len();
            }
            saved.tabs.push(SavedWorkspace {
                label: label.clone(),
                route: records[label].route.clone(),
            });
        }
        if !saved.tabs.is_empty() {
            session.groups.push(saved);
        }
        if native.isKeyWindow() {
            session.active = Some(label.clone());
        }
    }
    if session.active.is_none() {
        session.active = crate::workspace_windows::workspaces(app)
            .active
            .clone()
            .filter(|label| records.contains_key(label));
    }
    let routes = records
        .iter()
        .map(|(label, entry)| (label.clone(), entry.route.clone()))
        .collect();
    session.merge_hidden_groups(&hidden, &routes);
    session
        .groups
        .sort_by_key(|group| !group.tabs.iter().any(|tab| tab.label == "main"));
    session
}

/// Save shortly after a workspace changed route. Navigation bursts (a redirect, then the
/// normalised chat route) coalesce into one write of the last state.
#[cfg(target_os = "macos")]
pub(crate) fn save_soon<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use tauri::Manager;
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DEBOUNCE);
        if GENERATION.load(Ordering::Acquire) != generation
            || handle.state::<crate::quit::QuitState>().is_exiting()
        {
            return;
        }
        save(&handle);
    });
}

/// Save on the shared blocking pool instead of a thread per call. `save` waits on the main thread,
/// so it must never run there.
#[cfg(target_os = "macos")]
pub(crate) fn save_in_background<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || save(&handle));
}

/// Called off the main thread after every workspace flushed; one bounded main-thread read.
#[cfg(target_os = "macos")]
pub(crate) fn save<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    static WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _write = WRITES.lock().unwrap();
    let handle = app.clone();
    let Some(session) =
        crate::round_trip::run_on_main_sync(CAPTURE_TIMEOUT, move || snapshot(&handle))
    else {
        crate::log::logln("workspace session capture timed out");
        return;
    };
    let Some(path) = session_path(app) else {
        return;
    };
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        std::fs::create_dir_all(path.parent().ok_or("missing session directory")?)?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&session)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    })();
    if let Err(error) = result {
        crate::log::logln(format!("workspace session save failed: {error}"));
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn restore(app: &tauri::AppHandle) {
    use tauri::Manager;
    let session = load(app);
    crate::workspace_windows::workspaces(app).active = session.active.clone();
    for group in session.groups {
        let mut host = None;
        for tab in &group.tabs {
            if app.get_window(&tab.label).is_some() {
                if let Some(entry) = crate::workspace_windows::workspaces(app)
                    .entries
                    .get_mut(&tab.label)
                {
                    entry.host = host.clone();
                    entry.hidden = group.hidden;
                }
                host = Some(tab.label.clone());
            } else {
                match crate::workspace_windows::open_restored(
                    app,
                    host.clone(),
                    tab.route.clone(),
                    tab.label.clone(),
                    group.hidden,
                ) {
                    Ok(label) => {
                        host = Some(label);
                    }
                    Err(error) => crate::log::logln(format!("workspace restore failed: {error}")),
                }
            }
        }
        let mut data = crate::workspace_windows::workspaces(app);
        if group.hidden {
            data.hidden_groups.push(group.clone());
        }
        for (index, tab) in group.tabs.iter().enumerate() {
            if let Some(entry) = data.entries.get_mut(&tab.label) {
                entry.hidden = group.hidden;
                entry.focus_on_reveal =
                    !group.hidden && session.active.as_deref() == Some(&tab.label);
                entry.select_on_reveal = !group.hidden && index == group.selected;
                if index + 1 == group.tabs.len() {
                    entry.restore_frame = group.frame;
                    entry.restore_fullscreen = group.fullscreen;
                }
            }
        }
    }
}
