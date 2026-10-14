//! The native header uses the UI's resolved sidebar coat over the shared glass.
use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSCompositingOperation, NSRectFillUsingOperation, NSView,
    NSWindow, NSWindowOrderingMode,
};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use tauri::{Manager, Window};

pub(crate) const HEADER_TINT_TAG: isize = 91376256;

pub(crate) fn valid_tint(tint: [f64; 4]) -> bool {
    tint.iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
}

fn header_rect(bounds: CGRect, content: CGRect, titlebar_height: f64) -> CGRect {
    // The UI paints the shared button/toolbar row. Only native tabs need a coat here.
    let top = bounds.origin.y + bounds.size.height - titlebar_height;
    let bottom = (content.origin.y + content.size.height).clamp(bounds.origin.y, top);
    CGRect::new(
        CGPoint::new(bounds.origin.x, bottom),
        CGSize::new(bounds.size.width, top - bottom),
    )
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[ivars = [f64; 4]]
    struct HeaderCoat;
    unsafe impl NSObjectProtocol for HeaderCoat {}
    impl HeaderCoat {
        #[unsafe(method(tag))]
        fn tag(&self) -> isize { HEADER_TINT_TAG }

        // The backing view spans the frame, but paints only ABOVE contentLayoutRect.
        // This leaves the UI's own sidebar/workspace coats exactly as they were.
        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: CGRect) {
            let Some(window) = self.window() else { return };
            let content = window.contentLayoutRect();
            let content = self.convertRect_fromView(content, None);
            let height = crate::native_chrome::measure(&window).map_or(0.0, |g| if g.fullscreen { 0.0 } else { g.titlebar_height });
            let rect = header_rect(self.bounds(), content, height);
            let [r, g, b, a] = *self.ivars();
            NSColor::colorWithSRGBRed_green_blue_alpha(r, g, b, a).setFill();
            NSRectFillUsingOperation(rect, NSCompositingOperation::SourceOver);
        }

        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: CGPoint) -> *mut NSView { std::ptr::null_mut() }

        #[unsafe(method(layout))]
        fn layout(&self) {
            unsafe { let _: () = msg_send![super(self), layout]; }
            self.setNeedsDisplay(true);
        }
    }
);

pub(crate) fn apply(window: &Window, tint: [f64; 4]) -> Result<(), String> {
    if !valid_tint(tint) {
        return Err("Invalid native header colour".into());
    }
    let mtm = MainThreadMarker::new().ok_or("Native header requires the main thread")?;
    let ptr = window.ns_window().map_err(|error| error.to_string())?;
    let native = unsafe { &*ptr.cast::<NSWindow>() };
    let content = native.contentView().ok_or("Window has no content view")?;
    let frame = unsafe { content.superview() }.ok_or("Window has no frame view")?;
    crate::native_titlebar_backdrop::synchronize(&frame);
    crate::native_tab_controls::synchronize(&frame);
    if let Some(previous) = frame.viewWithTag(HEADER_TINT_TAG) {
        previous.removeFromSuperview();
    }
    let coat = HeaderCoat::alloc(mtm).set_ivars(tint);
    let coat: Retained<HeaderCoat> =
        unsafe { msg_send![super(coat), initWithFrame: frame.bounds()] };
    // Keep the translucent coat in its own composited layer, like WKWebView's UI.
    coat.setWantsLayer(true);
    coat.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    let glass = frame.viewWithTag(crate::window_material::FRAME_MATERIAL_TAG);
    frame.addSubview_positioned_relativeTo(&coat, NSWindowOrderingMode::Above, glass.as_deref());
    coat.setNeedsDisplay(true);
    Ok(())
}

pub(crate) fn invalidate(window: &Window) {
    crate::native_chrome::synchronize(window);
    if let Ok(ptr) = window.ns_window() {
        let native = unsafe { &*ptr.cast::<NSWindow>() };
        if let Some(frame) = native
            .contentView()
            .and_then(|content| unsafe { content.superview() })
        {
            crate::native_titlebar_backdrop::synchronize(&frame);
            crate::native_tab_controls::synchronize(&frame);
            if let Some(coat) = frame.viewWithTag(HEADER_TINT_TAG) {
                coat.setNeedsDisplay(true);
            }
        }
    }
}

pub(crate) fn refresh_after_focus(app: &tauri::AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    // AppKit can replace the native titlebar shortly after selecting/closing a tab.
    crate::main_queue::after(std::time::Duration::from_millis(50), move || {
        if let Some(window) = app.get_window(&label) {
            invalidate(&window);
        }
    });
}

#[cfg(debug_assertions)]
pub(crate) fn read_tint(frame: &NSView) -> Option<[f64; 4]> {
    frame
        .viewWithTag(HEADER_TINT_TAG)?
        .downcast::<HeaderCoat>()
        .ok()
        .map(|coat| *coat.ivars())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_coat_stops_at_the_ui_edge_when_native_tabs_change_height() {
        let bounds = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1280.0, 860.0));
        for content_height in [832.0, 804.0, 860.0, 900.0] {
            let content = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1280.0, content_height));
            let coat = header_rect(bounds, content, 28.0);
            assert_eq!(coat.origin.y, content_height.min(832.0));
            assert_eq!(coat.origin.y + coat.size.height, 832.0);
            assert!(coat.size.height >= 0.0);
        }
    }
    #[test]
    fn only_finite_srgb_components_are_accepted() {
        assert!(valid_tint([0.0, 0.5, 1.0, 0.7]));
        for value in [f64::NAN, f64::INFINITY, -0.01, 1.01] {
            assert!(!valid_tint([value, 0.0, 0.0, 0.7]));
            assert!(!valid_tint([0.0, 0.0, 0.0, value]));
        }
    }
}
