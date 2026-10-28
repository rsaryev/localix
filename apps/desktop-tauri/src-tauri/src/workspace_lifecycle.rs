//! Per-workspace first paint and bounded close; the last window remains reopenable.
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

/// A workspace that never reports first paint (a crashed page, a stuck load) is revealed anyway
/// after this long, so a window is never left invisible.
const FIRST_PAINT_FALLBACK: std::time::Duration = std::time::Duration::from_secs(4);
pub(crate) fn register(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    crate::workspace_windows::workspaces(&app)
        .entries
        .entry(label.clone())
        .or_default();
    #[cfg(target_os = "macos")]
    crate::macos_tabs::install_new_tab_action(&app, &window.as_ref().window());
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            crate::workspace_windows::workspaces(&app).active = Some(label.clone());
            crate::menu::activate_workspace(&app, &label);
            #[cfg(target_os = "macos")]
            crate::native_header::refresh_after_focus(&app, &label);
            #[cfg(target_os = "macos")]
            {
                let restore_hidden = {
                    let data = crate::workspace_windows::workspaces(&app);
                    data.entries
                        .get(&label)
                        .is_some_and(|entry| entry.focus_can_reopen())
                        && data
                            .hidden_groups
                            .iter()
                            .any(|group| group.tabs.iter().any(|tab| tab.label == label))
                };
                // AppKit may deliver a queued focus event after orderOut already hid that tab.
                // Only an actual newly visible/key window is a native Window-menu reopen.
                let visible_key = app.get_window(&label).is_some_and(|window| {
                    window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
                });
                if restore_hidden && visible_key {
                    crate::workspace_visibility::reopen_for_label(&app, &label);
                }
            }
        }
        #[cfg(target_os = "macos")]
        WindowEvent::Resized(_) => {
            let handle = app.clone();
            let label = label.clone();
            crate::macos_tabs::defer(move || {
                if let Some(window) = handle.get_window(&label) {
                    crate::native_header::invalidate(&window);
                }
            });
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            close(&app, &label);
        }
        WindowEvent::Destroyed => {
            #[cfg(target_os = "macos")]
            crate::workspace_drag_image::remove(&label);
            app.state::<crate::workspace_transfer::WorkspaceTransfers>()
                .cancel(&label);
            #[cfg(target_os = "macos")]
            crate::workspace_drag::cancel_owner(&app, &label);
            app.state::<crate::native_browser_lifecycle::NativeBrowserLifecycle>()
                .forget_owner(&label);
            #[cfg(target_os = "macos")]
            crate::native_browser_state::forget_owner(&label);
            let _removed = crate::workspace_windows::workspaces(&app)
                .entries
                .remove(&label);
            #[cfg(target_os = "macos")]
            if _removed.is_some_and(|entry| !entry.provisional)
                && !app.state::<crate::quit::QuitState>().is_exiting()
            {
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    if !handle.state::<crate::quit::QuitState>().is_exiting() {
                        crate::workspace_session::save(&handle);
                    }
                });
            }
            crate::menu::remove_workspace(&app, &label);
            #[cfg(target_os = "macos")]
            crate::macos_tabs::remove_new_tab_action(&label);
            #[cfg(target_os = "macos")]
            crate::native_chrome::remove(&label);
        }
        _ => {}
    });
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_PAINT_FALLBACK);
        let ready = crate::workspace_windows::workspaces(&app)
            .entries
            .get(&label)
            .is_none_or(|entry| entry.ready || entry.provisional);
        if !ready {
            reveal(&app, &label);
        }
    });
}

pub(crate) fn reveal(app: &AppHandle, label: &str) {
    let pending = {
        let mut data = crate::workspace_windows::workspaces(app);
        let Some(entry) = data.entries.get_mut(label) else {
            return;
        };
        entry.ready = true;
        if data.held {
            return;
        }
        let mut pending = Vec::new();
        loop {
            let next = data
                .entries
                .iter()
                .find(|(_, entry)| {
                    entry.allows_reveal()
                        && entry.host.as_ref().is_none_or(|host| {
                            data.entries.get(host).is_none_or(|parent| parent.revealed)
                        })
                })
                .map(|(label, _)| label.clone());
            let Some(next) = next else {
                break;
            };
            let entry = data.entries.get_mut(&next).unwrap();
            entry.revealed = true;
            pending.push((
                next,
                entry.host.take(),
                entry.focus_on_reveal,
                entry.select_on_reveal,
                entry.restore_frame.take(),
                entry.restore_fullscreen,
            ));
        }
        pending
    };
    for (label, host, focus, select, frame, fullscreen) in pending {
        #[cfg(target_os = "macos")]
        {
            crate::macos_tabs::reveal(app, &label, host.as_deref(), focus, select);
            if frame.is_some() || fullscreen {
                crate::macos_tabs::restore_geometry(app, &label, frame, fullscreen);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (host, focus, select, frame, fullscreen);
            if let Some(window) = app.get_window(&label) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

/// End a background launch's hold and reveal the workspaces it kept back, the way first paint
/// would have. False when nothing was held back, so the caller reopens as usual.
pub(crate) fn release_hold(app: &AppHandle) -> bool {
    let ready = {
        let mut data = crate::workspace_windows::workspaces(app);
        if !std::mem::take(&mut data.held) {
            return false;
        }
        data.entries
            .iter()
            .find(|(_, entry)| entry.allows_reveal())
            .map(|(label, _)| label.clone())
    };
    // Not painted yet: first paint reveals it now that the hold is gone.
    let Some(label) = ready else {
        return false;
    };
    reveal(app, &label);
    true
}

pub(crate) fn close(app: &AppHandle, label: &str) {
    #[cfg(target_os = "macos")]
    crate::workspace_drag::cancel_owner(app, label);
    let last = {
        let mut data = crate::workspace_windows::workspaces(app);
        let Some(last) = data.reserve_close(label) else {
            return;
        };
        last
    };
    crate::log::logln(format!("workspace close: {label}, keep last={last}"));
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        crate::frontend_flush::flush(&app, std::slice::from_ref(&label), !last);
        let handle = app.clone();
        let finish = move || {
            let Some(window) = handle.get_window(&label) else {
                return;
            };
            if last {
                if cfg!(target_os = "macos") || crate::tray::tray_available() {
                    let _ = window.hide();
                    if let Some(entry) = crate::workspace_windows::workspaces(&handle)
                        .entries
                        .get_mut(&label)
                    {
                        entry.closing = false;
                        entry.hidden = true;
                        entry.hidden_at = Some(std::time::Instant::now());
                    }
                    #[cfg(target_os = "macos")]
                    crate::workspace_session::save_in_background(&handle);
                } else {
                    handle.exit(0);
                }
            } else {
                let _ = window.destroy();
            }
        };
        #[cfg(target_os = "macos")]
        crate::macos_tabs::defer(finish);
        #[cfg(not(target_os = "macos"))]
        let _ = app.run_on_main_thread(finish);
    });
}
