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
        let destroy = {
            let mut data = crate::workspace_windows::workspaces(&app);
            if data.other_group_visible(&labels) {
                true
            } else if data.reserve_hide(&labels) {
                false
            } else {
                return;
            }
        };
        // Another window stays on screen, so this group is not the Dock-reopen target: a hidden
        // copy would keep running the whole app (socket, plugins, streaming) for nobody.
        if destroy {
            for label in &labels {
                crate::workspace_lifecycle::close(&app, label);
            }
            return;
        }
        std::thread::spawn(move || {
            crate::frontend_flush::flush(&app, &labels, false);
            let handle = app.clone();
            crate::macos_tabs::defer(move || {
                let selected = &group.tabs[group.selected].label;
                let (should_hide, stale) = {
                    let mut data = crate::workspace_windows::workspaces(&handle);
                    let pending = data.entries.get(selected).is_some_and(|entry| entry.hiding);
                    let mut stale = Vec::new();
                    if pending {
                        // One retained group: an older one is replaced, not accumulated.
                        stale = std::mem::replace(&mut data.hidden_groups, vec![group.clone()]);
                    } else {
                        for label in &labels {
                            if let Some(entry) = data.entries.get_mut(label) {
                                entry.hiding = false;
                            }
                        }
                    }
                    (pending, stale)
                };
                for label in stale.iter().flat_map(|group| &group.tabs) {
                    if !labels.contains(&label.label) {
                        crate::workspace_lifecycle::close(&handle, &label.label);
                    }
                }
                if should_hide {
                    // orderOut removes a tab and selects another: hide every member, retaining
                    // the pre-hide group so neither reopen nor Quit sees detached stubs.
                    for label in &labels {
                        if let Some(window) = handle.get_window(label) {
                            let _ = window.hide();
                        }
                    }
                    let mut data = crate::workspace_windows::workspaces(&handle);
                    for label in &labels {
                        if let Some(entry) = data.entries.get_mut(label) {
                            entry.hiding = false;
                            entry.hidden = true;
                            entry.hidden_at = Some(std::time::Instant::now());
                        }
                    }
                    data.active = Some(selected.clone());
                    drop(data);
                    let handle = handle.clone();
                    keep_hidden(handle.clone(), labels.clone(), 0);
                    crate::workspace_session::save_in_background(&handle);
                }
            });
        });
    });
}

/// How often, and how many times, a hidden group is checked for a member AppKit put back.
const KEEP_HIDDEN_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
const KEEP_HIDDEN_CHECKS: u8 = 10;

/// Ordering out the selected tab makes AppKit select a sibling and order it front on a later
/// pass, after the sibling's own hide already ran: the group was recorded hidden while one
/// window stayed on screen. Re-hide any member still flagged hidden; a reopen clears the flag
/// first, so this never fights one.
fn keep_hidden(app: AppHandle, labels: Vec<String>, check: u8) {
    if check == KEEP_HIDDEN_CHECKS {
        return;
    }
    crate::main_queue::after(KEEP_HIDDEN_INTERVAL, move || {
        let hidden: Vec<_> = {
            let data = crate::workspace_windows::workspaces(&app);
            labels
                .iter()
                .filter(|label| data.entries.get(*label).is_some_and(|entry| entry.hidden))
                .cloned()
                .collect()
        };
        if hidden.is_empty() {
            return;
        }
        for label in &hidden {
            if let Some(window) = app.get_window(label) {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                }
            }
        }
        keep_hidden(app, hidden, check + 1);
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
            let mut data = crate::workspace_windows::workspaces(&app);
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
                    entry.hidden_at = None;
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
        crate::workspace_windows::workspaces(&app).active = Some(window.label().into());
        crate::workspace_session::save_in_background(&app);
    });
}
