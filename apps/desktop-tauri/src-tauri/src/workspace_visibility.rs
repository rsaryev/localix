//! Window close retains the whole group; explicit tab close removes one workspace.
use crate::workspace_session_model::SavedGroup;
use objc2_app_kit::{NSWindow, NSWindowOrderingMode, NSWindowTabbingMode};
use tauri::{AppHandle, Manager};

pub(crate) fn hide(app: &AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    crate::macos_tabs::defer(move || {
        let session = crate::workspace_session::snapshot(&app);
        let Some(mut group) = session
            .groups
            .into_iter()
            .find(|group| group.tabs.iter().any(|tab| tab.label == label))
        else {
            return;
        };
        group.hidden = true;
        let labels: Vec<_> = group.tabs.iter().map(|tab| tab.label.clone()).collect();
        {
            let state = app.state::<crate::workspace_windows::WorkspaceWindows>();
            if !state.0.lock().unwrap().reserve_hide(&labels) {
                return;
            }
        }
        std::thread::spawn(move || {
            crate::frontend_flush::flush(&app, &labels, false);
            let handle = app.clone();
            crate::macos_tabs::defer(move || {
                let selected = &group.tabs[group.selected].label;
                let should_hide = {
                    let state = handle.state::<crate::workspace_windows::WorkspaceWindows>();
                    let mut data = state.0.lock().unwrap();
                    let pending = data.entries.get(selected).is_some_and(|entry| entry.hiding);
                    if pending {
                        data.hidden_groups.push(group.clone());
                    } else {
                        for label in &labels {
                            if let Some(entry) = data.entries.get_mut(label) {
                                entry.hiding = false;
                            }
                        }
                    }
                    pending
                };
                if should_hide {
                    // orderOut removes a tab and selects another: hide every member, retaining
                    // the pre-hide group so neither reopen nor Quit sees detached stubs.
                    for label in &labels {
                        if let Some(window) = handle.get_window(label) {
                            let _ = window.hide();
                        }
                    }
                    let state = handle.state::<crate::workspace_windows::WorkspaceWindows>();
                    let mut data = state.0.lock().unwrap();
                    for label in &labels {
                        if let Some(entry) = data.entries.get_mut(label) {
                            entry.hiding = false;
                            entry.hidden = true;
                        }
                    }
                    data.active = Some(selected.clone());
                    drop(data);
                    let handle = handle.clone();
                    std::thread::spawn(move || crate::workspace_session::save(&handle));
                }
            });
        });
    });
}

fn restore_group<R: tauri::Runtime>(app: &AppHandle<R>, group: SavedGroup) -> Option<String> {
    let mut anchor = None;
    for tab in &group.tabs {
        let Some(window) = app.get_window(&tab.label) else {
            continue;
        };
        let Ok(ptr) = window.ns_window() else {
            continue;
        };
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        native.setTabbingMode(NSWindowTabbingMode::Disallowed);
        if let Some(previous) = anchor {
            let previous = unsafe { &*(previous as *const NSWindow) };
            native.setTabbingMode(NSWindowTabbingMode::Automatic);
            previous.setTabbingMode(NSWindowTabbingMode::Automatic);
            previous.addTabbedWindow_ordered(native, NSWindowOrderingMode::Above);
        } else {
            native.orderFront(None);
        }
        anchor = Some(ptr as usize);
    }
    let selected = group.tabs.get(group.selected)?.label.clone();
    let window = app.get_window(&selected)?;
    let ptr = window.ns_window().ok()?;
    let native = unsafe { &*ptr.cast::<NSWindow>() };
    native.setTabbingMode(NSWindowTabbingMode::Automatic);
    if let Some(tabs) = native.tabGroup() {
        tabs.setSelectedWindow(Some(native));
    }
    if let Some([x, y, width, height]) = group.frame {
        use objc2_core_foundation::{CGPoint, CGRect, CGSize};
        let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(width, height));
        native.setFrame_display(
            native.constrainFrameRect_toScreen(rect, native.screen().as_deref()),
            true,
        );
    }
    Some(selected)
}

/// Dock, tray, deep links and second launches all reveal the same retained group.
pub(crate) fn reopen<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Some(window) = crate::workspace_windows::active_window(app) else {
        return;
    };
    reopen_for_label(app, window.label());
}

/// Also used when AppKit's own Window menu reveals a hidden member directly.
pub(crate) fn reopen_for_label<R: tauri::Runtime>(app: &AppHandle<R>, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    crate::macos_tabs::defer(move || {
        let hidden = {
            let state = app.state::<crate::workspace_windows::WorkspaceWindows>();
            let mut data = state.0.lock().unwrap();
            if let Some(entry) = data.entries.get_mut(&label) {
                entry.hiding = false;
            }
            let group = data
                .hidden_groups
                .iter()
                .position(|group| group.tabs.iter().any(|tab| tab.label == label))
                .map(|index| data.hidden_groups.remove(index));
            let labels = group
                .as_ref()
                .map(|group| {
                    group
                        .tabs
                        .iter()
                        .map(|tab| tab.label.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![label.clone()]);
            if labels.iter().any(|label| {
                data.entries
                    .get(label)
                    .is_some_and(|entry| entry.provisional)
            }) {
                return;
            }
            for label in labels {
                if let Some(entry) = data.entries.get_mut(&label) {
                    entry.hidden = false;
                    entry.hiding = false;
                    entry.revealed = true;
                    entry.host = None;
                }
            }
            group
        };
        let selected = hidden
            .and_then(|group| restore_group(&app, group))
            .unwrap_or(label);
        let Some(window) = app.get_window(&selected) else {
            return;
        };
        let Ok(ptr) = window.ns_window() else { return };
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        let selected = native.tabGroup().and_then(|group| group.selectedWindow());
        let native = selected.as_deref().unwrap_or(native);
        native.deminiaturize(None);
        native.makeKeyAndOrderFront(None);
        if let Some(mtm) = objc2::MainThreadMarker::new() {
            #[allow(deprecated)]
            objc2_app_kit::NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        }
        let state = app.state::<crate::workspace_windows::WorkspaceWindows>();
        state.0.lock().unwrap().active = Some(window.label().into());
        std::thread::spawn(move || crate::workspace_session::save(&app));
    });
}
