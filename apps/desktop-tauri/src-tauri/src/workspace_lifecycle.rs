//! Per-workspace first paint and bounded close; the last window remains reopenable.
use crate::workspace_windows::WorkspaceWindows;
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};
pub(crate) fn register(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    app.state::<WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .entries
        .entry(label.clone())
        .or_default();
    #[cfg(target_os = "macos")]
    crate::macos_tabs::install_new_tab_action(&app, &window.as_ref().window());
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => {
            app.state::<WorkspaceWindows>().0.lock().unwrap().active = Some(label.clone());
            crate::menu::activate_workspace(&app, &label);
            #[cfg(target_os = "macos")]
            crate::native_header::refresh_after_focus(&app, &label);
            #[cfg(target_os = "macos")]
            {
                let restore_hidden = {
                    let state = app.state::<WorkspaceWindows>();
                    let data = state.0.lock().unwrap();
                    data.entries.get(&label).is_some_and(|entry| !entry.hiding)
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
            let removed = app
                .state::<WorkspaceWindows>()
                .0
                .lock()
                .unwrap()
                .entries
                .remove(&label);
            #[cfg(target_os = "macos")]
            if removed.is_some_and(|entry| !entry.provisional)
                && !app.state::<crate::quit::QuitState>().is_exiting()
            {
                let handle = app.clone();
                std::thread::spawn(move || {
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
        std::thread::sleep(std::time::Duration::from_secs(4));
        let ready = app
            .state::<WorkspaceWindows>()
            .0
            .lock()
            .unwrap()
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
        let state = app.state::<WorkspaceWindows>();
        let mut data = state.0.lock().unwrap();
        let Some(entry) = data.entries.get_mut(label) else {
            return;
        };
        entry.ready = true;
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

pub(crate) fn close(app: &AppHandle, label: &str) {
    #[cfg(target_os = "macos")]
    crate::workspace_drag::cancel_owner(app, label);
    let last = {
        let state = app.state::<WorkspaceWindows>();
        let mut data = state.0.lock().unwrap();
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
                    if let Some(entry) = handle
                        .state::<WorkspaceWindows>()
                        .0
                        .lock()
                        .unwrap()
                        .entries
                        .get_mut(&label)
                    {
                        entry.closing = false;
                        entry.hidden = true;
                    }
                    #[cfg(target_os = "macos")]
                    {
                        let handle = handle.clone();
                        std::thread::spawn(move || crate::workspace_session::save(&handle));
                    }
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
