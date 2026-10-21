//! Measure AppKit chrome for the full-size workspace, without polling or guessed tab heights.
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObjectProtocol};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly, Message};
use objc2_app_kit::{NSWindow, NSWindowButton, NSWindowStyleMask};
use objc2_foundation::{ns_string, NSDictionary, NSKeyValueChangeKey, NSObject, NSString};
use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use tauri::{AppHandle, Manager, Window};

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Geometry {
    pub(crate) titlebar_height: f64,
    pub(crate) tabbar_height: f64,
    pub(crate) button_gap: f64,
    pub(crate) fullscreen: bool,
}

fn geometry_from_sizes(inset: f64, titlebar: f64, button_right: f64, fullscreen: bool) -> Geometry {
    if fullscreen {
        return Geometry {
            titlebar_height: 36.0,
            tabbar_height: inset.max(0.0),
            button_gap: 8.0,
            fullscreen: true,
        };
    }
    let titlebar_height = titlebar.clamp(28.0, 80.0);
    Geometry {
        titlebar_height,
        tabbar_height: (inset - titlebar_height).max(0.0),
        button_gap: button_right.max(0.0) + 8.0,
        fullscreen: false,
    }
}

pub(crate) fn measure(native: &NSWindow) -> Option<Geometry> {
    let content = native.contentView()?;
    let frame = unsafe { content.superview() }?;
    let bounds = frame.bounds();
    let top = bounds.origin.y + bounds.size.height;
    let layout = frame.convertRect_fromView(native.contentLayoutRect(), None);
    let inset = top - layout.origin.y - layout.size.height;
    if native.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return Some(geometry_from_sizes(inset, 0.0, 0.0, true));
    }
    let close = native.standardWindowButton(NSWindowButton::CloseButton)?;
    let close_rect = frame.convertRect_fromView(close.bounds(), Some(&close));
    // NSTitlebarView includes native tab accessories (68px on Tahoe). Its bounds
    // are not the button row. The real buttons stay centred in the top row.
    let button_row = 2.0 * (top - close_rect.origin.y - close_rect.size.height / 2.0);
    let mut button_right: f64 = 0.0;
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = native.standardWindowButton(kind) {
            let rect = frame.convertRect_fromView(button.bounds(), Some(&button));
            button_right = button_right.max(rect.origin.x + rect.size.width - bounds.origin.x);
        }
    }
    Some(geometry_from_sizes(inset, button_row, button_right, false))
}

struct Context {
    app: AppHandle,
    label: String,
    native: Retained<NSWindow>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = Context]
    struct ChromeObserver;
    unsafe impl NSObjectProtocol for ChromeObserver {}
    impl ChromeObserver {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn observe(&self, _key: Option<&NSString>, _object: Option<&AnyObject>,
            _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>, _context: *mut c_void) {
            // KVO may arrive inside Tao's window event handler. Defer all bridge work.
            let app = self.ivars().app.clone();
            let label = self.ivars().label.clone();
            crate::main_queue::defer(move || {
                if let Some(window) = app.get_window(&label) {
                    synchronize(&window);
                    crate::native_header::invalidate(&window);
                }
            });
        }
    }
);

thread_local! {
    static OBSERVERS: RefCell<HashMap<String, Retained<ChromeObserver>>> = RefCell::new(HashMap::new());
}

pub(crate) fn install(app: &AppHandle, window: &Window) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("Native chrome requires the main thread")?;
    let ptr = window.ns_window().map_err(|error| error.to_string())?;
    let native = unsafe { &*ptr.cast::<NSWindow>() };
    let observer = ChromeObserver::alloc(mtm).set_ivars(Context {
        app: app.clone(),
        label: window.label().into(),
        native: native.retain(),
    });
    let observer: Retained<ChromeObserver> = unsafe { msg_send![super(observer), init] };
    unsafe {
        let _: () = msg_send![native, addObserver: &*observer, forKeyPath: ns_string!("contentLayoutRect"), options: 0usize, context: std::ptr::null_mut::<c_void>()];
    }
    OBSERVERS.with(|observers| {
        observers
            .borrow_mut()
            .insert(window.label().into(), observer);
    });
    synchronize(window);
    Ok(())
}

pub(crate) fn remove(label: &str) {
    let label = label.to_string();
    crate::main_queue::defer(move || {
        OBSERVERS.with(|observers| {
            if let Some(observer) = observers.borrow_mut().remove(&label) {
                unsafe {
                    let _: () = msg_send![&*observer.ivars().native, removeObserver: &*observer, forKeyPath: ns_string!("contentLayoutRect")];
                }
            }
        });
    });
}

/// The page side of a measurement: the kit's titlebar strip reads these (`chrome.css`). Shared by
/// the workspace and plugin apps (`app_runner.rs`), so both lay the strip out the same way.
pub(crate) fn apply_script(geometry: Geometry) -> String {
    format!(
        "(()=>{{const apply=()=>{{const r=document.documentElement;r.dataset.fullscreen='{}';const s=r.style;s.setProperty('--titlebar-height','{}px');s.setProperty('--native-tabbar-height','{}px');s.setProperty('--native-window-button-gap','{}px');}};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{{once:true}});}})()",
        geometry.fullscreen, geometry.titlebar_height, geometry.tabbar_height, geometry.button_gap,
    )
}

pub(crate) fn synchronize(window: &Window) {
    OBSERVERS.with(|observers| {
        let observers = observers.borrow();
        let Some(observer) = observers.get(window.label()) else {
            return;
        };
        let state = observer.ivars();
        let Some(geometry) = measure(&state.native) else {
            return;
        };
        if let Some(view) = state.app.get_webview(&state.label) {
            let _ = view.eval(apply_script(geometry));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tabs_reserve_only_the_band_below_the_shared_toolbar() {
        assert_eq!(
            geometry_from_sizes(28.0, 28.0, 68.0, false),
            Geometry {
                titlebar_height: 28.0,
                tabbar_height: 0.0,
                button_gap: 76.0,
                fullscreen: false,
            }
        );
        assert_eq!(
            geometry_from_sizes(56.0, 28.0, 68.0, false).tabbar_height,
            28.0
        );
        assert_eq!(
            geometry_from_sizes(66.0, 38.0, 78.0, false).tabbar_height,
            28.0
        );
        // Tahoe's titlebar container grows to 68px, but its button row remains 32px.
        let tahoe = geometry_from_sizes(68.0, 32.0, 69.0, false);
        assert_eq!(tahoe.titlebar_height, 32.0);
        assert_eq!(tahoe.tabbar_height, 36.0);
    }
    #[test]
    fn fullscreen_releases_buttons_and_keeps_any_visible_tabs() {
        assert_eq!(
            geometry_from_sizes(0.0, 28.0, 68.0, true),
            Geometry {
                titlebar_height: 36.0,
                tabbar_height: 0.0,
                button_gap: 8.0,
                fullscreen: true,
            }
        );
        assert_eq!(
            geometry_from_sizes(28.0, 28.0, 68.0, true).tabbar_height,
            28.0
        );
        assert_eq!(
            geometry_from_sizes(-1.0, 28.0, 68.0, true).tabbar_height,
            0.0
        );
    }
}
