//! Linux hosting for browser pages: a `gtk::Fixed` laid over the workbench window.
//!
//! `Window::add_child` packs a child webview into the window's `gtk::Box`, where it ignores the
//! frame it is given, and wry positions a child only when its parent is a `gtk::Fixed`. So the
//! window is restructured once into `Overlay → [vbox (the app view), Fixed (pages)]`, each page's
//! webkit widget is moved from the vbox into the Fixed right after `add_child` creates it, and its
//! frame is applied with `Fixed::move_` plus a size request. Everything else about a page — its
//! label, events, navigation, theme — stays the `tauri::Webview` the other platforms use.
//!
//! The Fixed passes input through wherever no page sits, so the app view underneath keeps every
//! click and key that is not over a page.

use gtk::prelude::*;
use tauri::Webview;

/// Key of the page layer stored on the window's own GTK object.
const PAGE_LAYER: &str = "localix-browser-pages";

/// The page layer of the window a page is in, created on first use.
///
/// Runs inside `with_webview`, which Tauri calls on the GTK main thread; a Tauri command does not
/// run there on Linux, and GTK aborts the process when it is touched from any other thread. The
/// GTK objects are therefore reached from the page widget itself rather than passed in.
fn page_layer(widget: &gtk::Widget) -> Option<gtk::Fixed> {
    let window = widget.toplevel()?.downcast::<gtk::Window>().ok()?;
    // SAFETY: the key only ever holds a `gtk::Fixed`, set below on this same object.
    if let Some(fixed) = unsafe { window.data::<gtk::Fixed>(PAGE_LAYER) } {
        return Some(unsafe { fixed.as_ref() }.clone());
    }
    // The window's only child is Tauri's vbox (the app view and any new page).
    let vbox = window.child()?;
    window.remove(&vbox);
    let overlay = gtk::Overlay::new();
    overlay.add(&vbox);
    let fixed = gtk::Fixed::new();
    fixed.set_can_focus(false);
    overlay.add_overlay(&fixed);
    overlay.set_overlay_pass_through(&fixed, true);
    window.add(&overlay);
    overlay.show_all();
    // SAFETY: read back above with the same type.
    unsafe { window.set_data(PAGE_LAYER, fixed.clone()) };
    Some(fixed)
}

/// Move a freshly created page out of the window's vbox into the page layer.
pub(crate) fn adopt(view: &Webview) -> Result<(), String> {
    view.with_webview(|platform| {
        let widget: gtk::Widget = platform.inner().upcast();
        let Some(fixed) = page_layer(&widget) else {
            crate::log::logln("browser page: no window to host the page in");
            return;
        };
        if let Some(parent) = widget.parent() {
            if let Ok(container) = parent.downcast::<gtk::Container>() {
                container.remove(&widget);
            }
        }
        fixed.put(&widget, 0, 0);
    })
    .map_err(|error| error.to_string())
}

/// Where the app view starts inside the page layer. The layer covers the whole window, the GTK
/// menu bar included, while page frames are measured from the app view's own origin.
fn app_view_origin(fixed: &gtk::Fixed) -> (i32, i32) {
    let app_view = fixed
        .parent()
        .and_then(|overlay| overlay.downcast::<gtk::Overlay>().ok())
        .and_then(|overlay| overlay.child())
        .and_then(|vbox| vbox.downcast::<gtk::Container>().ok())
        .and_then(|vbox| vbox.children().into_iter().last());
    app_view.map_or((0, 0), |view| {
        let allocation = view.allocation();
        (allocation.x(), allocation.y())
    })
}

/// Give a page its frame, in logical pixels relative to the app view.
pub(crate) fn place(view: &Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    view.with_webview(move |platform| {
        let widget: gtk::Widget = platform.inner().upcast();
        let Some(fixed) = page_layer(&widget) else {
            return;
        };
        let (left, top) = app_view_origin(&fixed);
        widget.set_size_request(width.round() as i32, height.round() as i32);
        fixed.move_(&widget, left + x.round() as i32, top + y.round() as i32);
        // A move leaves the previous rectangle painted; repaint the window under it.
        if let Some(window) = widget.toplevel() {
            window.queue_draw();
        }
    })
    .map_err(|error| error.to_string())
}

/// Hide a page and repaint the window under it. The page layer has no window of its own, so
/// without the repaint the app view kept the hidden page's last frame on screen.
pub(crate) fn hide(view: &Webview) -> Result<(), String> {
    view.with_webview(|platform| {
        let widget: gtk::Widget = platform.inner().upcast();
        widget.hide();
        if let Some(window) = widget.toplevel() {
            window.queue_draw();
        }
    })
    .map_err(|error| error.to_string())
}
