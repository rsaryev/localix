//! Native timers keep lifecycle evidence running while hidden WKWebView pages are throttled.
use objc2_app_kit::{NSWindow, NSWindowButton};
use std::sync::mpsc::Sender;
use tauri::{AppHandle, Manager};

pub(crate) fn run(
    app: AppHandle,
    label: String,
    action: String,
    result: Sender<serde_json::Value>,
) {
    eprintln!("[window-lifecycle] start {action}");
    if action == "red_close_reopen" {
        if let Some(window) = app.get_window(&label) {
            if let Ok(ptr) = window.ns_window() {
                let native = unsafe { &*ptr.cast::<NSWindow>() };
                if let Some(button) = native.standardWindowButton(NSWindowButton::CloseButton) {
                    unsafe {
                        button.performClick(None);
                    }
                }
            }
        }
    } else if action == "minimize_reopen" {
        if let Some(window) = crate::workspace_windows::active_window(&app) {
            if let Ok(ptr) = window.ns_window() {
                let native = unsafe { &*ptr.cast::<NSWindow>() };
                native.miniaturize(None);
            }
        }
    } else {
        crate::workspace_visibility::hide(&app, &label);
    }
    inspect_later(app, action, result, 0);
}

fn inspect_later(app: AppHandle, action: String, result: Sender<serde_json::Value>, attempt: u8) {
    crate::main_queue::after(std::time::Duration::from_millis(100), move || {
        let mut state = crate::workspace_probe::snapshot(&app);
        let windows = state["windows"].as_array().unwrap();
        let finished = if action == "minimize_reopen" {
            windows.iter().any(|window| window["minimized"] == true)
        } else {
            !windows.is_empty() && windows.iter().all(|window| window["visible"] == false)
        };
        if attempt == 0 || finished {
            eprintln!("[window-lifecycle] {action}: attempt={attempt} finished={finished}");
        }
        if !finished && attempt < 80 {
            inspect_later(app, action, result, attempt + 1);
            return;
        }
        state["lifecycleComplete"] = serde_json::json!(finished);
        let _ = result.send(state);
        if action == "hide_quit" {
            app.exit(if finished { 0 } else { 1 });
        } else {
            crate::deeplink::show_main_window(&app);
        }
    });
}
