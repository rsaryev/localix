//! A mini app installed as its own Mac app.
//!
//! `Kanban.app` in `~/Applications/Localix Apps` is a copy-on-write clone of this binary with its
//! own bundle id, name and icon, the way Chrome's installed web apps and Parallels' Windows apps
//! are made. macOS therefore gives it its own Dock icon, menu bar, Cmd+Tab entry and window frame,
//! while Localix stays the host: the runtime, the mini app and all of its data live there, and the
//! app shows the mini app's page against it. `main` asks [`run_if_app`] before anything else, so a
//! standalone mini app never starts the Tauri shell, its single-instance lock or a runtime of its
//! own.
use std::path::PathBuf;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSColor, NSWindow,
    NSWindowStyleMask, NSWindowTabbingMode,
};
use objc2_foundation::{ns_string, NSBundle, NSPoint, NSRect, NSSize, NSString, NSTimer};
use objc2_web_kit::WKWebView;

use crate::app_runner_host as host;
use crate::app_runner_web::{configuration, Controller};

/// The flag a standalone mini app starts Localix with: everything runs, no workspace shows.
pub(crate) const BACKGROUND_ARG: &str = "--background";
/// The page's scheme and origin when the UI is served from the host bundle.
pub(crate) const SCHEME: &str = "localix-app";
pub(crate) const PAGE_ORIGIN: &str = "localix-app://app";

/// The Info.plist keys the installer writes and this runner reads.
pub(crate) mod keys {
    /// The mini app the bundle hosts.
    pub(crate) const MINI_APP: &str = "LocalixMiniApp";
    /// The UI build directory, or the development server's URL.
    pub(crate) const UI: &str = "LocalixUi";
    /// The runtime's endpoint descriptor file.
    pub(crate) const ENDPOINT: &str = "LocalixEndpoint";
    /// The host's `.app`, or its bare binary in development.
    pub(crate) const HOST: &str = "LocalixHost";
    /// The app's own project folder: its conversations are that project's.
    pub(crate) const PROJECT: &str = "LocalixProject";
}

/// How long a cold Localix may take to answer before the app says it could not start it.
const HOST_START_LIMIT: Duration = Duration::from_secs(60);
const TICK: f64 = 0.25;
/// Once connected, the runtime is re-checked every this many ticks.
const CONNECTED_CHECK_EVERY: u32 = 8;

pub(crate) enum Ui {
    Directory(PathBuf),
    Url(String),
}

pub(crate) struct Config {
    pub(crate) mini_app: String,
    pub(crate) name: String,
    pub(crate) ui: Ui,
    pub(crate) endpoint: PathBuf,
    pub(crate) host: PathBuf,
    pub(crate) project: PathBuf,
}

/// Run as a standalone mini app when this bundle is one. False for Localix itself.
pub(crate) fn run_if_app() -> bool {
    let (Some(config), Some(mtm)) = (config(), MainThreadMarker::new()) else {
        return false;
    };
    run(mtm, config);
    true
}

fn config() -> Option<Config> {
    let bundle = NSBundle::mainBundle();
    let read = |key: &str| {
        let value = bundle.objectForInfoDictionaryKey(&NSString::from_str(key))?;
        Some(value.downcast::<NSString>().ok()?.to_string())
    };
    let mini_app =
        read(keys::MINI_APP).filter(|mini_app| crate::app_bundle::valid_mini_app(mini_app))?;
    let ui = read(keys::UI)?;
    let ui = if ui.starts_with("http://") {
        Ui::Url(ui)
    } else {
        Ui::Directory(PathBuf::from(ui))
    };
    Some(Config {
        name: read("CFBundleName").unwrap_or_else(|| mini_app.clone()),
        mini_app,
        ui,
        endpoint: PathBuf::from(read(keys::ENDPOINT)?),
        host: PathBuf::from(read(keys::HOST)?),
        project: PathBuf::from(read(keys::PROJECT)?),
    })
}

fn run(mtm: MainThreadMarker, config: Config) {
    // The project is found by its folder, so the folder has to exist before the page asks.
    if let Err(error) = std::fs::create_dir_all(&config.project) {
        crate::log::logln(format!(
            "standalone mini app: cannot create {}: {error}",
            config.project.display()
        ));
    }
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
    let name = config.name.clone();
    let controller = Controller::new(mtm, config);
    app.setDelegate(Some(ProtocolObject::from_ref(&*controller)));
    crate::app_runner_menu::install(mtm, &app, &controller, &name);
    open_window(mtm, &controller, &name);
    watch_host(mtm, &controller);
    app.run();
}

fn open_window(mtm: MainThreadMarker, controller: &Retained<Controller>, name: &str) {
    // Full-size content under a transparent titlebar: the glass runs edge to edge, as in the
    // workspace, while AppKit still draws the title and drags the window by its titlebar.
    let style = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Miniaturizable
        | NSWindowStyleMask::Resizable
        | NSWindowStyleMask::FullSizeContentView;
    let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1024.0, 720.0));
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            frame,
            style,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    unsafe { window.setReleasedWhenClosed(false) };
    window.setTitle(&NSString::from_str(name));
    window.setMinSize(NSSize::new(420.0, 320.0));
    window.setTabbingMode(NSWindowTabbingMode::Disallowed);
    // The page draws the title row itself, beside the window buttons, as the workspace does.
    window.setTitleVisibility(objc2_app_kit::NSWindowTitleVisibility::Hidden);
    window.setTitlebarAppearsTransparent(true);
    window.setOpaque(false);
    window.setBackgroundColor(Some(&NSColor::clearColor()));
    window.center();
    // Each app is its own bundle, so each remembers its own frame in its own defaults.
    let autosave = ns_string!("LocalixMiniApp");
    window.setFrameUsingName(autosave);
    window.setFrameAutosaveName(autosave);

    let web_view = unsafe {
        WKWebView::initWithFrame_configuration(
            WKWebView::alloc(mtm),
            frame,
            &configuration(mtm, controller),
        )
    };
    // Transparent, so the glass behind it shows until the page paints and through its coats after.
    let no = objc2_foundation::NSNumber::new_bool(false);
    unsafe {
        let _: () =
            objc2::msg_send![&web_view, setValue: &*no, forKey: ns_string!("drawsBackground")];
        web_view.setNavigationDelegate(Some(ProtocolObject::from_ref(&**controller)));
    }
    let page_ui = crate::app_runner_ui::PageUi::new(mtm);
    unsafe { web_view.setUIDelegate(Some(ProtocolObject::from_ref(&*page_ui))) };
    let _ = controller.ivars().page_ui.set(page_ui);
    #[cfg(debug_assertions)]
    unsafe {
        web_view.setInspectable(true)
    };
    let glass = crate::app_runner_glass::attach(mtm, &window, &web_view);
    window.setDelegate(Some(ProtocolObject::from_ref(&**controller)));
    window.makeKeyAndOrderFront(None);
    let state = controller.ivars();
    let _ = state.glass.set(glass);
    let _ = state.web_view.set(web_view);
    let _ = state.window.set(window);
}

/// Connect to the running Localix, or start it in the background and wait for it. Once
/// connected, a runtime that restarted on another port reloads the page against the new one, and
/// a host that went away is started again.
fn watch_host(mtm: MainThreadMarker, controller: &Retained<Controller>) {
    let controller = controller.clone();
    let ticks = std::cell::Cell::new(0u32);
    let block = block2::RcBlock::new(move |_timer: std::ptr::NonNull<NSTimer>| {
        let state = controller.ivars();
        let tick = ticks.get().wrapping_add(1);
        ticks.set(tick);
        if state.port.get().is_some() && !tick.is_multiple_of(CONNECTED_CHECK_EVERY) {
            return;
        }
        match (state.port.get(), host::live_port(&state.config.endpoint)) {
            (Some(current), Some(port)) if current == port => {}
            (_, Some(port)) => {
                state.port.set(Some(port));
                state.waiting_since.set(None);
                state.asked_host.set(false);
                state.gave_up.set(false);
                controller.load_page(mtm, port);
            }
            (_, None) => {
                let since = state.waiting_since.get().unwrap_or_else(|| {
                    if state.port.get().is_none() {
                        controller.show_notice("Starting Localix…");
                    }
                    Instant::now()
                });
                state.waiting_since.set(Some(since));
                // A running Localix whose runtime is restarting answers on its own; opening it
                // again would be a reopen, which shows its workspace windows. Otherwise it is
                // started once per wait.
                if !state.asked_host.get() && !host::is_running(&state.config.host) {
                    state.asked_host.set(true);
                    if let Err(error) = host::launch(&state.config.host) {
                        controller.show_notice(&format!("Could not start Localix: {error}"));
                    }
                }
                if since.elapsed() > HOST_START_LIMIT && !state.gave_up.replace(true) {
                    state.port.set(None);
                    controller.show_notice("Localix did not start. Open Localix, then try again.");
                }
            }
        }
    });
    let _timer =
        unsafe { NSTimer::scheduledTimerWithTimeInterval_repeats_block(TICK, true, &block) };
}
