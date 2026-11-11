//! The agent island: one small window at the top of the screen that shows the requests waiting for
//! the person and the light of working agents. It never joins the workspace/tab registry.
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use tauri::{AppHandle, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

pub(crate) const LABEL: &str = "island";
// The page commands keep their `island::` paths for `generate_handler!`.
pub(crate) use crate::island_commands::*;

/// The island's fixed scale, mirrored by `features/agent-island/model/geometry.ts`; change both.
/// The canvas never resizes. Only the visible silhouette inside it does.
pub(crate) mod geometry {
    pub(crate) const CANVAS_WIDTH: f64 = 720.0;
    pub(crate) const CANVAS_HEIGHT: f64 = 680.0;
    /// One open size: room for a request card.
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

/// What the folded island shows, and so what it accepts. The page decides; the host enforces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Mode {
    /// Nothing works or waits: fully transparent and click-through.
    Hidden,
    /// Agents work: the light runs, but there is nothing to open, so clicks pass through.
    Working,
    /// A request waits: the light is warm and the notch opens on hover or click.
    Waiting,
}

impl Mode {
    fn to_u8(self) -> u8 {
        match self {
            Mode::Hidden => 0,
            Mode::Working => 1,
            Mode::Waiting => 2,
        }
    }
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Mode::Working,
            2 => Mode::Waiting,
            _ => Mode::Hidden,
        }
    }
}

#[derive(Default)]
pub(crate) struct IslandState {
    pub(crate) ready: AtomicBool,
    pub(crate) visible: AtomicBool,
    pub(crate) started: AtomicBool,
    pub(crate) suspended: AtomicBool,
    pub(crate) phase_revision: AtomicU64,
    pub(crate) expanded: AtomicBool,
    mode: AtomicU8,
    /// A portaled menu is open; hit testing covers the whole canvas meanwhile.
    pub(crate) grabbing: AtomicBool,
    pub(crate) expanded_height: AtomicU64,
    pub(crate) motion_duration: AtomicU64,
    pub(crate) motion_easing: std::sync::Mutex<Option<[f32; 4]>>,
    pub(crate) corner_radius: AtomicU64,
}

impl IslandState {
    pub(crate) fn mode(&self) -> Mode {
        Mode::from_u8(self.mode.load(Ordering::Acquire))
    }
    pub(crate) fn set_mode(&self, mode: Mode) {
        self.mode.store(mode.to_u8(), Ordering::Release);
    }
    /// Nothing is working or waiting and the island is folded: it draws nothing at all.
    pub(crate) fn quiet(&self) -> bool {
        !self.expanded.load(Ordering::Acquire) && self.mode() == Mode::Hidden
    }
    /// Whether the island has anything to open: it takes hover and clicks only then.
    pub(crate) fn interactive(&self) -> bool {
        self.expanded.load(Ordering::Acquire) || self.mode() == Mode::Waiting
    }
}

fn defer(work: impl FnOnce() + Send + 'static) {
    crate::main_queue::defer(work);
}

pub(crate) fn start_once(app: &AppHandle) {
    if !crate::prefs::island_enabled(app) {
        return;
    }
    if !app
        .state::<IslandState>()
        .started
        .swap(true, Ordering::AcqRel)
    {
        request_show(app);
    }
}

/// Create the window if needed and put it on screen. The page keeps it transparent until an
/// agent works or a request waits.
pub(crate) fn request_show(app: &AppHandle) {
    if !crate::prefs::island_enabled(app) {
        return;
    }
    let handle = app.clone();
    defer(move || {
        if let Err(error) = show(&handle) {
            crate::log::logln(format!("island: {error}"));
        }
    });
}

pub(crate) fn is_island(caller: &Webview) -> bool {
    caller.label() == LABEL && caller.window().label() == LABEL
}

pub(crate) fn show(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<IslandState>();
    state.visible.store(true, Ordering::Release);
    if state.suspended.load(Ordering::Acquire) {
        return Ok(());
    }
    if app.get_webview_window(LABEL).is_some() {
        if state.ready.load(Ordering::Acquire) {
            crate::island_macos::show(app);
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
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()));
    let builder = crate::display_options::stamped(builder)
        .title("Localix Agent Island")
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
            "{init}window.__LOCALIX_ISLAND=true;window.location.hash='/island';"
        ))
        .on_navigation(crate::deeplink::is_internal_url);
    let window = builder.build().map_err(|error| error.to_string())?;
    crate::island_macos::install(app, &window)?;
    place(app, false)?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            let app = handle.clone();
            defer(move || collapse(&app));
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide(&handle);
        }
    });
    Ok(())
}

/// Unfold or fold the silhouette. Unfolding never takes the keyboard: a request that arrives
/// while the person types elsewhere must not receive their next Enter. Only a click inside the
/// card makes the panel key (`island_pointer`), and folding hands the keyboard back.
pub(crate) fn place(app: &AppHandle, expanded: bool) -> Result<(), String> {
    let was_expanded = app
        .state::<IslandState>()
        .expanded
        .swap(expanded, Ordering::AcqRel);
    if was_expanded != expanded {
        app.state::<IslandState>()
            .phase_revision
            .fetch_add(1, Ordering::AcqRel);
    }
    let placed = crate::island_macos::place(app);
    if !expanded && was_expanded {
        crate::island_macos::release_key_after_fold(app);
    }
    placed
}

pub(crate) fn hide(app: &AppHandle) {
    app.state::<IslandState>()
        .visible
        .store(false, Ordering::Release);
    collapse(app);
    if app.get_webview_window(LABEL).is_some() {
        crate::island_macos::hide(app);
    }
}

/// Folding never resolves a pending request: it stays in the app, and the light stays on.
pub(crate) fn collapse(app: &AppHandle) {
    use tauri::Emitter;
    app.state::<IslandState>()
        .grabbing
        .store(false, Ordering::Release);
    let _ = app.emit_to(LABEL, "island-collapse", ());
    let _ = place(app, false);
}

#[cfg(test)]
mod tests {
    use super::{geometry, IslandState, Mode};

    #[test]
    fn a_folded_island_with_nothing_to_show_is_quiet_and_inert() {
        let state = IslandState::default();
        assert!(state.quiet());
        assert!(!state.interactive());
    }

    #[test]
    fn working_draws_light_but_takes_no_clicks() {
        let state = IslandState::default();
        state.set_mode(Mode::Working);
        assert!(!state.quiet());
        assert!(!state.interactive());
    }

    #[test]
    fn a_waiting_request_makes_the_notch_interactive() {
        let state = IslandState::default();
        state.set_mode(Mode::Waiting);
        assert!(!state.quiet());
        assert!(state.interactive());
    }

    #[test]
    fn the_open_height_follows_content_within_the_canvas() {
        assert_eq!(geometry::open_height(None), geometry::OPEN_MAX_HEIGHT);
        assert_eq!(geometry::open_height(Some(1)), geometry::OPEN_MIN_HEIGHT);
        assert_eq!(
            geometry::open_height(Some(9_999)),
            geometry::OPEN_MAX_HEIGHT
        );
        assert_eq!(geometry::open_height(Some(200)), 200);
    }
}
