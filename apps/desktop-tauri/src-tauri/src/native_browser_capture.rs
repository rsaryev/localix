//! Pictures of a native browser page or of a region of the main view: what a capture is for,
//! how WebKit is asked for it, and how the result is encoded.

use serde::Serialize;
use std::time::Duration;
use tauri::Webview;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserImage {
    data: String,
    media_type: &'static str,
    width: u32,
    height: u32,
}

/// What a capture is for, which decides how it is taken and how it is encoded.
#[derive(Clone, Copy)]
pub(super) enum Capture {
    /// Evidence for the agent: every pending paint included, lossless.
    Exact,
    /// The picture that stands in for the live page while app HTML covers its rectangle. It has
    /// to arrive before the overlay's entrance animation ends, so it takes the frame already on
    /// screen instead of waiting for the next paint, and ships as JPEG instead of a PNG that is
    /// several times larger to encode and to carry over IPC.
    Placeholder,
    /// One rectangle of the MAIN view (a plugin's workbench panel), in CSS pixels, for the agent.
    /// Re-rendering the panel's DOM instead (`modern-screenshot`) inlines the computed style of
    /// every element on the page's one thread: a board with a few thousand nodes froze the whole
    /// app for minutes. The compositor already holds these pixels. JPEG, as the DOM path sent.
    // Read only where the native capture exists (macOS); elsewhere the fields are never read.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Region {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

/// The longest edge a region capture is delivered at, in points: enough to read a board, and a
/// fraction of a full-resolution window over IPC and in the model's context.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const REGION_MAX_EDGE: f64 = 1600.0;

#[cfg(target_os = "macos")]
pub(super) async fn capture(
    view: Webview,
    kind: Capture,
    timeout: Duration,
) -> Result<BrowserImage, String> {
    use base64::Engine;
    use objc2::{runtime::AnyObject, AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageCompressionFactor,
    };
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<BrowserImage, String>>();
    view.with_webview(move |platform| {
        let webview: &WKWebView = unsafe { &*platform.inner().cast() };
        let configuration = match kind {
            Capture::Exact => None,
            Capture::Placeholder => MainThreadMarker::new().map(|mtm| {
                let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
                unsafe { configuration.setAfterScreenUpdates(false) };
                configuration
            }),
            Capture::Region {
                x,
                y,
                width,
                height,
            } => MainThreadMarker::new().map(|mtm| {
                use objc2_core_foundation::{CGPoint, CGRect, CGSize};
                let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
                let rect = CGRect::new(CGPoint::new(x, y), CGSize::new(width, height));
                let scale = (REGION_MAX_EDGE / width.max(height)).min(1.0);
                let target = NSNumber::new_f64((width * scale).round());
                unsafe {
                    configuration.setRect(rect);
                    configuration.setSnapshotWidth(Some(&target));
                }
                configuration
            }),
        };
        let callback = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = if !error.is_null() {
                Err(unsafe { (&*error).localizedDescription().to_string() })
            } else if image.is_null() {
                Err("WebKit returned no browser image".to_string())
            } else {
                let image = unsafe { &*image };
                let size = image.size();
                let (file_type, media_type) = match kind {
                    Capture::Exact => (NSBitmapImageFileType::PNG, "image/png"),
                    Capture::Placeholder | Capture::Region { .. } => {
                        (NSBitmapImageFileType::JPEG, "image/jpeg")
                    }
                };
                image
                    .TIFFRepresentation()
                    .ok_or_else(|| "WebKit image has no bitmap representation".to_string())
                    .and_then(|tiff| {
                        NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
                            .ok_or_else(|| "Could not decode WebKit image".to_string())
                    })
                    .and_then(|bitmap| {
                        let quality = NSNumber::new_f64(0.75);
                        let properties = match kind {
                            Capture::Exact => NSDictionary::<NSString, AnyObject>::new(),
                            Capture::Placeholder | Capture::Region { .. } => {
                                NSDictionary::from_slices(
                                    &[unsafe { NSImageCompressionFactor }],
                                    &[AsRef::<AnyObject>::as_ref(&*quality)],
                                )
                            }
                        };
                        unsafe { bitmap.representationUsingType_properties(file_type, &properties) }
                            .ok_or_else(|| format!("Could not encode WebKit image as {media_type}"))
                    })
                    .map(|encoded| BrowserImage {
                        data: base64::engine::general_purpose::STANDARD.encode(encoded.to_vec()),
                        media_type,
                        width: size.width.round() as u32,
                        height: size.height.round() as u32,
                    })
            };
            let _ = tx.send(result);
        });
        unsafe {
            webview.takeSnapshotWithConfiguration_completionHandler(
                configuration.as_deref(),
                &callback,
            )
        };
    })
    .map_err(|error| error.to_string())?;
    crate::round_trip::await_reply(rx, timeout, "Browser snapshot timed out").await?
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn capture(
    view: Webview,
    kind: Capture,
    timeout: Duration,
) -> Result<BrowserImage, String> {
    let _ = (view, kind, timeout);
    Err("Native browser screenshots are not yet supported on this platform".into())
}
