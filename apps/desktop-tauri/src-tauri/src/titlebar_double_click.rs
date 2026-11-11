//! A double-click on the title row does what System Settings says.
//!
//! Desktop & Dock → "Double-click a window's title bar to" is stored as `AppleActionOnDoubleClick`
//! (`Maximize`, which the pane calls Zoom, `Fill`, `Minimize` or `None`); older systems kept only
//! `AppleMiniaturizeOnDoubleClick`. Tauri's drag script answers every double-click on a
//! `data-tauri-drag-region` with its own maximize (`plugin:window|internal_toggle_maximize`), which
//! never reads the setting: a person who chose Minimize or nothing got a zoom. The workspace page
//! routes the gesture here instead (`apps/ui/src/shared/lib/titlebarDoubleClick.ts`), and so does a
//! standalone mini app's title row (`app_runner_host::DRAG_SCRIPT`).

// Only the macOS build reads the setting; the reading is plain and tested everywhere.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

/// What the gesture does.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Zoom,
    Minimize,
    Nothing,
}

/// The setting as the system stores it, read into an action. `Fill` has no public AppKit call, so
/// it zooms, the nearest standard behaviour; anything unknown falls back to the older switch.
pub(crate) fn action(setting: Option<&str>, legacy_minimize: bool) -> Action {
    match setting {
        Some("Maximize") | Some("Fill") => Action::Zoom,
        Some("Minimize") => Action::Minimize,
        Some("None") => Action::Nothing,
        _ if legacy_minimize => Action::Minimize,
        _ => Action::Zoom,
    }
}

/// Do what the person chose to `window`, on the main thread.
#[cfg(target_os = "macos")]
pub(crate) fn perform(window: &objc2_app_kit::NSWindow) {
    use objc2_foundation::{ns_string, NSUserDefaults};
    let defaults = NSUserDefaults::standardUserDefaults();
    let setting = defaults
        .stringForKey(ns_string!("AppleActionOnDoubleClick"))
        .map(|value| value.to_string());
    let legacy = defaults.boolForKey(ns_string!("AppleMiniaturizeOnDoubleClick"));
    match action(setting.as_deref(), legacy) {
        Action::Zoom => window.performZoom(None),
        Action::Minimize => window.performMiniaturize(None),
        Action::Nothing => {}
    }
}

/// The workspace page's double-click on its title row.
#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn titlebar_double_click(window: tauri::Window) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(ptr) = target.ns_window() {
            perform(unsafe { &*ptr.cast::<objc2_app_kit::NSWindow>() });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{action, Action};

    #[test]
    fn zoom_is_the_default_and_what_maximize_means() {
        assert_eq!(action(None, false), Action::Zoom);
        assert_eq!(action(Some("Maximize"), false), Action::Zoom);
        assert_eq!(action(Some("Fill"), false), Action::Zoom);
    }

    #[test]
    fn minimize_and_nothing_are_honoured() {
        assert_eq!(action(Some("Minimize"), false), Action::Minimize);
        assert_eq!(action(Some("None"), false), Action::Nothing);
    }

    #[test]
    fn the_newer_setting_wins_over_the_older_switch() {
        assert_eq!(action(Some("Maximize"), true), Action::Zoom);
        assert_eq!(action(None, true), Action::Minimize);
        assert_eq!(action(Some("Unknown"), true), Action::Minimize);
    }
}
