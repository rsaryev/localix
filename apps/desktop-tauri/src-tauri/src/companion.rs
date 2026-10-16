//! One small agent-control window. It never joins the workspace/tab registry.
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub(crate) const LABEL: &str = "companion";
// The page commands keep their `companion::` paths for `generate_handler!`.
pub(crate) use crate::companion_commands::*;

pub(crate) const SHORTCUT: &str = "CommandOrControl+Shift+J";

/// The island's fixed scale, mirrored by `features/companion/model/geometry.ts`; change both.
/// The canvas never resizes. Only the visible silhouette inside it does.
pub(crate) mod geometry {
    pub(crate) const CANVAS_WIDTH: f64 = 720.0;
    pub(crate) const CANVAS_HEIGHT: f64 = 680.0;
    /// One open size: room for a reply without a separate enlarged mode.
    pub(crate) const OPEN_WIDTH: u64 = 580;
    pub(crate) const OPEN_MIN_HEIGHT: u64 = 64;
    pub(crate) const OPEN_MAX_HEIGHT: u64 = CANVAS_HEIGHT as u64;
    /// Resting strip on a display without a notch: a small target at the top center.
    pub(crate) const COMPACT_WIDTH: f64 = 48.0;
    pub(crate) const MOTION_MAX_MS: u64 = 300;
    pub(crate) const RADIUS_DEFAULT: u64 = 24;
    pub(crate) const RADIUS_RANGE: (u64, u64) = (4, 48);

    pub(crate) fn open_height(height: Option<u64>) -> u64 {
        height
            .unwrap_or(OPEN_MAX_HEIGHT)
            .clamp(OPEN_MIN_HEIGHT, OPEN_MAX_HEIGHT)
    }
}

#[derive(Default)]
pub(crate) struct CompanionState {
    pub(crate) ready: AtomicBool,
    pub(crate) visible: AtomicBool,
    pub(crate) started: AtomicBool,
    activate_on_ready: AtomicBool,
    pub(crate) suspended: AtomicBool,
    pub(crate) phase_revision: AtomicU64,
    pub(crate) expanded: AtomicBool,
    /// Nothing is working or waiting: the resting island is fully transparent.
    pub(crate) quiet: AtomicBool,
    /// A composer menu is open; hit testing covers the whole canvas meanwhile.
    pub(crate) grabbing: AtomicBool,
    pub(crate) expanded_height: AtomicU64,
    pub(crate) motion_duration: AtomicU64,
    pub(crate) motion_easing: std::sync::Mutex<Option<[f32; 4]>>,
    pub(crate) corner_radius: AtomicU64,
}

fn defer(_app: &AppHandle, work: impl FnOnce() + Send + 'static) {
    crate::main_queue::defer(work);
}

pub(crate) fn start_once(app: &AppHandle) {
    if !crate::prefs::island_enabled(app) {
        return;
    }
    if !app
        .state::<CompanionState>()
        .started
        .swap(true, Ordering::AcqRel)
    {
        let handle = app.clone();
        defer(app, move || {
            if let Err(error) = show(&handle) {
                crate::log::logln(format!("companion: {error}"));
            }
        });
    }
}

pub(crate) fn request_show(app: &AppHandle) {
    if !crate::prefs::island_enabled(app) {
        return;
    }
    let handle = app.clone();
    defer(app, move || {
        handle
            .state::<CompanionState>()
            .activate_on_ready
            .store(true, Ordering::Release);
        if let Err(error) = show(&handle) {
            crate::log::logln(format!("companion: {error}"));
        }
        activate_when_ready(&handle);
    });
}

pub(crate) fn activate_when_ready(app: &AppHandle) {
    let state = app.state::<CompanionState>();
    if state.ready.load(Ordering::Acquire)
        && !state.suspended.load(Ordering::Acquire)
        && state.activate_on_ready.swap(false, Ordering::AcqRel)
    {
        let _ = app.emit_to(LABEL, "companion-activate", ());
    }
}

pub(crate) fn is_companion(caller: &Webview) -> bool {
    caller.label() == LABEL && caller.window().label() == LABEL
}

pub(crate) fn install_shortcut(app: &AppHandle) {
    if let Err(error) = app
        .global_shortcut()
        .on_shortcut(SHORTCUT, |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if !crate::prefs::island_enabled(app) {
                return;
            }
            let handle = app.clone();
            defer(app, move || {
                if handle
                    .state::<CompanionState>()
                    .visible
                    .load(Ordering::Acquire)
                {
                    let _ = handle.emit_to(LABEL, "companion-toggle", ());
                    if let Some(window) = handle.get_window(LABEL) {
                        crate::companion_macos::focus(&handle);
                        let _ = window;
                    }
                } else {
                    request_show(&handle);
                }
            });
        })
    {
        // A shortcut claimed by another app never prevents Localix from starting.
        crate::log::logln(format!("companion shortcut unavailable: {error}"));
    }
}

pub(crate) fn show(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<CompanionState>();
    state.visible.store(true, Ordering::Release);
    if state.suspended.load(Ordering::Acquire) {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = &window;
        if state.ready.load(Ordering::Acquire) {
            crate::companion_macos::show(app);
        }
        return Ok(());
    }
    let init = app
        .state::<crate::workspace_windows::WorkspaceWindows>()
        .0
        .lock()
        .unwrap()
        .init_script
        .clone();
    // `None` is System. Forcing Dark here changes NSApplication's appearance before WKWebView
    // can read prefers-color-scheme, so a light macOS session would boot a dark island.
    let theme = crate::prefs::load_theme_is_dark(app).map(|dark| {
        if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }
    });
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Localix Companion")
        .inner_size(geometry::CANVAS_WIDTH, geometry::CANVAS_HEIGHT)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .visible_on_all_workspaces(true)
        .theme(theme)
        .disable_drag_drop_handler()
        .initialization_script(format!(
            "{init}window.__LOCALIX_COMPANION=true;window.location.hash='/companion';"
        ))
        .on_navigation(crate::deeplink::is_internal_url);
    let window = builder.build().map_err(|error| error.to_string())?;
    crate::companion_macos::install(app, &window)?;
    place(app, false)?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let app = handle.clone();
            defer(&handle, move || collapse(&app));
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide(&handle);
        }
    });
    Ok(())
}

pub(crate) fn place(app: &AppHandle, expanded: bool) -> Result<(), String> {
    let was_expanded = app
        .state::<CompanionState>()
        .expanded
        .swap(expanded, Ordering::AcqRel);
    if was_expanded != expanded {
        app.state::<CompanionState>()
            .phase_revision
            .fetch_add(1, Ordering::AcqRel);
    }
    {
        let placed = crate::companion_macos::place(app);
        // Like Spotlight, the open island is the key window, which is also what keeps Liquid
        // Glass in its active rendering. Folding hands the keyboard back.
        if expanded && !was_expanded {
            crate::companion_macos::focus(app);
        } else if !expanded && was_expanded {
            crate::companion_macos::release_key_after_fold(app);
        }
        placed
    }
}

pub(crate) fn hide(app: &AppHandle) {
    app.state::<CompanionState>()
        .visible
        .store(false, Ordering::Release);
    collapse(app);
    if let Some(window) = app.get_webview_window(LABEL) {
        crate::companion_macos::hide(app);
        let _ = window;
    }
}

/// Folding never changes the chat draft or resolves a pending interaction.
pub(crate) fn collapse(app: &AppHandle) {
    app.state::<CompanionState>()
        .grabbing
        .store(false, Ordering::Release);
    let _ = app.emit_to(LABEL, "companion-collapse", ());
    let _ = place(app, false);
}
