//! Captures are asynchronous, permission-free and never reveal a window themselves.
use crate::workspace_drag_state::Key;
use objc2::MainThreadMarker;
use objc2_app_kit::NSImage;
use objc2_foundation::{NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
use tauri::{AppHandle, Manager};

pub(crate) fn start(
    app: &AppHandle,
    key: &Key,
    destination: &str,
    label: String,
    rect: Option<[f64; 4]>,
    browser: bool,
    lease: Option<String>,
) {
    let Some(view) = app.get_webview(&label) else {
        return;
    };
    let app = app.clone();
    let key = key.clone();
    let destination = destination.to_string();
    let _ = view.with_webview(move |platform| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let webview = unsafe { &*platform.inner().cast::<WKWebView>() };
        let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
        unsafe {
            configuration.setAfterScreenUpdates(false);
        }
        if let Some([x, y, width, height]) = rect {
            unsafe {
                configuration.setRect(NSRect::new(NSPoint::new(x, y), NSSize::new(width, height)));
                configuration.setSnapshotWidth(Some(&NSNumber::new_f64(
                    width * (1600.0 / width.max(height)).min(1.0),
                )));
            }
        }
        let callback = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            if image.is_null()
                || !error.is_null()
                || !crate::workspace_drag_image::accepts(&app, &key, &destination)
            {
                return;
            }
            if browser
                && !app
                    .state::<crate::native_browser_lifecycle::NativeBrowserLifecycle>()
                    .accepts(&label, lease.as_deref())
            {
                return;
            }
            crate::workspace_drag_image::update(
                &app,
                &key,
                &destination,
                unsafe { &*image },
                browser,
            );
        });
        unsafe {
            webview
                .takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &callback);
        }
    });
}
