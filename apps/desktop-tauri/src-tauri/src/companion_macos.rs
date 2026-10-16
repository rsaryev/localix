//! AppKit owns placement, the glass silhouette and click-through; the webview owns content.
//!
//! `tauri_panel!` below also brings `MainThreadMarker`, `NSEvent`, `NSNotification`, `NSPoint`,
//! `NSRect` and `NSSize` into this module; importing them again would collide.
use objc2_app_kit::{
    NSAppearanceCustomization, NSScreen, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_nspanel::{tauri_panel, ManagerExt, WebviewWindowExt};

use crate::companion::{geometry, CompanionState, LABEL};

/// Resting strip height on a display without a notch: the menu-bar band.
const PLAIN_COMPACT_HEIGHT: f64 = 28.0;
/// Notch width when AppKit reports implausible auxiliary areas (mirroring, odd scaling).
const NOTCH_FALLBACK_WIDTH: f64 = 184.0;
const NOTCH_MAX_WIDTH: f64 = 400.0;

/// The last measured resting cutout, read by hit testing on every pointer update.
static COMPACT_WIDTH: AtomicU64 = AtomicU64::new(geometry::COMPACT_WIDTH as u64);
static COMPACT_HEIGHT: AtomicU64 = AtomicU64::new(PLAIN_COMPACT_HEIGHT as u64);

type Observer =
    objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2_foundation::NSObjectProtocol>>;

thread_local! {
    // Main-thread only; the observer lives as long as the process' single companion panel.
    static SCREEN_OBSERVER: RefCell<Option<Observer>> = const { RefCell::new(None) };
}

tauri_panel! {
    panel!(LocalixAgentPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// The hardware cutout the resting island wraps, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Cutout {
    notch_width: f64,
    notch_height: f64,
}

impl Cutout {
    fn measure(screen: &NSScreen) -> Self {
        let top = screen.safeAreaInsets().top;
        if top <= 0.0 {
            return Self {
                notch_width: 0.0,
                notch_height: 0.0,
            };
        }
        let measured = screen.frame().size.width
            - screen.auxiliaryTopLeftArea().size.width
            - screen.auxiliaryTopRightArea().size.width;
        Self {
            notch_width: if measured > 0.0 && measured < NOTCH_MAX_WIDTH {
                measured
            } else {
                NOTCH_FALLBACK_WIDTH
            },
            notch_height: top,
        }
    }

    fn has_notch(self) -> bool {
        self.notch_height > 0.0
    }

    /// The resting island is the notch itself: its glass hides behind the hardware, the activity
    /// beam traces the notch edge, and the menu-bar items beside it keep their clicks.
    fn compact(self) -> (f64, f64) {
        if self.has_notch() {
            (self.notch_width, self.notch_height)
        } else {
            (geometry::COMPACT_WIDTH, PLAIN_COMPACT_HEIGHT)
        }
    }
}

fn screen(app: &AppHandle) -> Result<objc2::rc::Retained<NSScreen>, String> {
    let mtm = MainThreadMarker::new().ok_or("Island geometry requires the main thread")?;
    // The island belongs to the menu bar, which macOS keeps on the first screen: with the lid open
    // beside a primary external display, the person works there, not at the laptop's notch. A
    // notched primary display measures its cutout; any other uses the compact resting strip.
    NSScreen::screens(mtm)
        .firstObject()
        .or_else(|| {
            app.get_webview_panel(LABEL)
                .ok()
                .and_then(|panel| panel.as_panel().screen())
        })
        .or_else(|| NSScreen::mainScreen(mtm))
        .ok_or_else(|| "No display is available".into())
}

/// The measured cutout plus the evidence the smoke check asserts.
pub(crate) fn geometry(app: &AppHandle) -> Result<serde_json::Value, String> {
    let screen = screen(app)?;
    let cutout = Cutout::measure(&screen);
    let (compact_width, compact_height) = cutout.compact();
    let panel = app
        .get_webview_panel(LABEL)
        .map_err(|error| format!("{error:?}"))?;
    let panel_frame = panel.as_panel().frame();
    let material = crate::companion_material::report(app);
    let screen_top = screen.frame().origin.y + screen.frame().size.height;
    Ok(serde_json::json!({
        "compactWidth": compact_width,
        "compactHeight": compact_height,
        "notchWidth": cutout.notch_width,
        "notchHeight": cutout.notch_height,
        "nativeMaterial": !material.is_null(),
        "materialKind": material["kind"],
        "materialWidth": material["width"],
        "materialHeight": material["height"],
        "materialAlpha": material["alpha"],
        "materialAppearance": material["appearance"],
        "nativePanel": panel.is_floating_panel() && !panel.can_become_main_window(),
        "expanded": app.state::<CompanionState>().expanded.load(Ordering::Acquire),
        "keyWindow": panel.as_panel().isKeyWindow(),
        "visible": panel.is_visible(),
        "appearance": panel.as_panel().effectiveAppearance().name().to_string(),
        "topGap": screen_top - (panel_frame.origin.y + panel_frame.size.height),
    }))
}

pub(crate) fn install(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let panel = window
        .to_panel::<LocalixAgentPanel>()
        .map_err(|e| e.to_string())?;
    panel
        .set_style_mask(NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel)
        .map_err(|e| e.to_string())?;
    // Above the menu bar so the island can wrap the notch, below system alerts.
    panel.set_level(objc2_app_kit::NSMainMenuWindowLevel as i64 + 3);
    panel.set_collection_behavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    panel.set_hides_on_deactivate(false);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_has_shadow(false);
    panel.set_opaque(false);
    panel
        .as_panel()
        .setBackgroundColor(Some(&objc2_app_kit::NSColor::clearColor()));
    panel.set_ignores_mouse_events(true);
    let dark = crate::prefs::load_theme_is_dark(app).unwrap_or_else(|| {
        panel
            .as_panel()
            .effectiveAppearance()
            .name()
            .to_string()
            .contains("Dark")
    });
    let theme = if dark { "dark" } else { "light" };
    if let Some(appearance) = crate::window_material::Appearance::parse(theme) {
        if let Err(error) = crate::companion_material::apply(&window.as_ref().window(), appearance)
        {
            crate::log::logln(format!("island material: {error}"));
        }
    }
    place(app)?;
    observe_screens(app);
    crate::companion_lifecycle::install(app);
    crate::companion_pointer::install(app);
    Ok(())
}

/// Displays come and go (a lid closes, a monitor is unplugged, the resolution changes). Re-anchor
/// and tell the page about a new cutout, instead of waiting for the next expand to notice.
fn observe_screens(app: &AppHandle) {
    let handle = app.clone();
    let block = block2::RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| {
        match place(&handle).and_then(|_| geometry(&handle)) {
            Ok(value) => {
                let _ = handle.emit_to(LABEL, "companion-geometry", value);
            }
            Err(error) => crate::log::logln(format!("companion screens: {error}")),
        }
    });
    // SAFETY: the notification name is an AppKit constant; a nil queue delivers the notification
    // on the posting thread, which is the main thread for screen parameter changes.
    let token = unsafe {
        objc2_foundation::NSNotificationCenter::defaultCenter()
            .addObserverForName_object_queue_usingBlock(
                Some(objc2_app_kit::NSApplicationDidChangeScreenParametersNotification),
                None,
                None,
                &block,
            )
    };
    SCREEN_OBSERVER.with_borrow_mut(|observer| *observer = Some(token));
}

/// Anchor the fixed canvas to the physical top of the chosen display and reshape the glass.
pub(crate) fn place(app: &AppHandle) -> Result<(), String> {
    let panel = app.get_webview_panel(LABEL).map_err(|e| format!("{e:?}"))?;
    let screen = screen(app)?;
    let frame = screen.frame();
    let target = NSRect::new(
        NSPoint::new(
            frame.origin.x + (frame.size.width - geometry::CANVAS_WIDTH) / 2.0,
            frame.origin.y + frame.size.height - geometry::CANVAS_HEIGHT,
        ),
        NSSize::new(geometry::CANVAS_WIDTH, geometry::CANVAS_HEIGHT),
    );
    if panel.as_panel().frame() != target {
        panel.as_panel().setFrame_display(target, true);
    }
    let (width, height) = Cutout::measure(&screen).compact();
    COMPACT_WIDTH.store(width.round() as u64, Ordering::Relaxed);
    COMPACT_HEIGHT.store(height.round() as u64, Ordering::Relaxed);
    crate::companion_material::shape(app);
    Ok(())
}

/// One geometry for native glass and pointer hit testing, for both resting and expanded phases.
pub(crate) fn visible_size(app: &AppHandle) -> (f64, f64) {
    let state = app.state::<CompanionState>();
    if state.expanded.load(Ordering::Acquire) {
        (
            geometry::OPEN_WIDTH as f64,
            geometry::open_height(Some(state.expanded_height.load(Ordering::Acquire))) as f64,
        )
    } else {
        (
            COMPACT_WIDTH.load(Ordering::Relaxed) as f64,
            COMPACT_HEIGHT.load(Ordering::Relaxed) as f64,
        )
    }
}

pub(crate) fn show(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        panel.order_front_regardless();
    }
}
pub(crate) fn hide(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        panel.hide();
    }
}
pub(crate) fn focus(app: &AppHandle) {
    let state = app.state::<CompanionState>();
    if !state.visible.load(Ordering::Acquire) || state.suspended.load(Ordering::Acquire) {
        return;
    }
    if let Ok(panel) = app.get_webview_panel(LABEL) {
        panel.make_key_window();
    }
}

/// Return the keyboard after the island folds. A nonactivating panel gives typing back to the
/// frontmost app (or to the workspace, when Localix is active) only by leaving the window list, so
/// it steps out and straight back in. That waits for the fold animation, when the resting island
/// is invisible or hidden by the notch, so nothing flickers.
pub(crate) fn release_key_after_fold(app: &AppHandle) {
    let revision = app
        .state::<CompanionState>()
        .phase_revision
        .load(Ordering::Acquire);
    let delay = app
        .state::<CompanionState>()
        .motion_duration
        .load(Ordering::Acquire)
        + 60;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay));
        crate::main_queue::defer(move || {
            let state = handle.state::<CompanionState>();
            if state.expanded.load(Ordering::Acquire)
                || state.phase_revision.load(Ordering::Acquire) != revision
            {
                return;
            }
            let Ok(panel) = handle.get_webview_panel(LABEL) else {
                return;
            };
            if !panel.as_panel().isKeyWindow() {
                return;
            }
            panel.hide();
            if state.visible.load(Ordering::Acquire) {
                panel.order_front_regardless();
            }
        });
    });
}
