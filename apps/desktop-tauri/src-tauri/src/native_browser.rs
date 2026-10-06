//! Browser pages are child system webviews inside the main workbench window.
//! Their labels have no app capability, so an arbitrary website cannot invoke
//! the commands used by the main UI to manage them.
//!
//! Not on Linux yet: wry positions a child webview with `set_bounds` only when it lives inside
//! a `gtk::Fixed`, and `add_child` packs it into the window's vbox, where it ignores its frame.
//! The UI therefore never picks the native engine on Linux (`browserEngine` in the UI's
//! `browserUrl.ts`) until the page is hosted in a `gtk::Fixed`.

use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};

static BROWSER_THEME: Mutex<Option<String>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn apply_theme_to_view(view: &Webview, theme: &str) -> Result<(), String> {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
    };
    use objc2_web_kit::WKWebView;

    let theme = theme.to_string();
    view.with_webview(move |platform| {
        let webview: &WKWebView = unsafe { &*platform.inner().cast() };
        let name = match theme.as_str() {
            "dark" => Some(unsafe { NSAppearanceNameDarkAqua }),
            "light" => Some(unsafe { NSAppearanceNameAqua }),
            _ => None,
        };
        let appearance = name.and_then(NSAppearance::appearanceNamed);
        webview.setAppearance(appearance.as_deref());
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn apply_theme_to_view(_view: &Webview, _theme: &str) -> Result<(), String> {
    Ok(())
}

pub(crate) fn apply_browser_theme(app: &AppHandle, theme: &str) {
    if let Ok(mut current) = BROWSER_THEME.lock() {
        *current = Some(theme.to_string());
    }
    for (label, view) in app.webviews() {
        if label.starts_with("browser-") {
            let _ = apply_theme_to_view(&view, theme);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPageEvent {
    tab_id: String,
    url: String,
    title: Option<String>,
    /// For `browser:navigated`: the load has started and not yet finished.
    loading: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserMenuEvent {
    tab_id: String,
    action: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserMenuState {
    pinned: bool,
    can_close_left: bool,
    can_close_right: bool,
    can_close_all: bool,
}

pub(crate) fn handle_browser_menu_event(app: &AppHandle, id: &str) -> bool {
    let Some(rest) = id.strip_prefix("browser-tab:") else {
        return false;
    };
    let Some((owner, rest)) = rest.split_once(':') else {
        return false;
    };
    if !crate::workspace_windows::is_workspace(app, owner) {
        return false;
    }
    let Some((tab_id, action)) = rest.split_once(':') else {
        return false;
    };
    if label(tab_id).is_err() {
        return false;
    }
    let _ = app.emit_to(
        owner,
        "browser:tab-menu",
        BrowserMenuEvent {
            tab_id: tab_id.to_string(),
            action: action.to_string(),
        },
    );
    true
}

#[tauri::command]
pub(crate) async fn browser_tab_menu(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    state: BrowserMenuState,
) -> Result<(), String> {
    require_main(&caller)?;
    label(&tab_id)?;
    let window = caller.window();
    let menu = Menu::new(&app).map_err(|error| error.to_string())?;
    for (action, title, enabled, separator) in [
        ("reload", "Reload", true, false),
        (
            "pin",
            if state.pinned { "Unpin tab" } else { "Pin tab" },
            true,
            false,
        ),
        ("close", "Close tab", true, true),
        (
            "close_right",
            "Close tabs to the right",
            state.can_close_right,
            false,
        ),
        (
            "close_left",
            "Close tabs to the left",
            state.can_close_left,
            false,
        ),
        (
            "close_all",
            "Close all unpinned tabs",
            state.can_close_all,
            false,
        ),
    ] {
        if separator {
            menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        }
        let item = MenuItem::with_id(
            &app,
            format!("browser-tab:{}:{tab_id}:{action}", caller.label()),
            title,
            enabled,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }
    menu.popup(window).map_err(|error| error.to_string())
}

/// Where the page sits in the window, in logical pixels, and whether it is shown at all.
///
/// A page is a platform view stacked above the app's own WebView, so the app never paints over
/// it and never reorders it: while app HTML needs the page's rectangle, the UI hides the page and
/// shows a picture of it instead (`browser_placeholder`). Visibility is the whole protocol.
#[derive(Deserialize)]
pub(crate) struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
}

fn require_main(caller: &Webview) -> Result<(), String> {
    crate::workspace_windows::require_workspace(caller)
}

fn label(tab_id: &str) -> Result<String, String> {
    if tab_id.len() < 8
        || tab_id.len() > 80
        || !tab_id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
    {
        return Err("Invalid browser tab ID".into());
    }
    Ok(format!("browser-{tab_id}"))
}

/// The user agent a page sees: the installed Safari, because that is the engine it runs on.
///
/// A plain WKWebView stops its user agent at `(KHTML, like Gecko)`, without the `Version/…
/// Safari/…` tokens, and sites that look for them treat the page as an unknown old browser.
/// Google serves that browser its legacy fixed-width page, which neither follows the pane's width
/// nor offers a dark theme; with these tokens it serves the page Safari gets. The OS and WebKit
/// tokens are the values WebKit itself freezes. Same shape as DuckDuckGo's macOS browser
/// (`UserAgent.swift`, with `SafariVersionReader` reading the Safari bundle).
#[cfg(target_os = "macos")]
fn safari_user_agent() -> &'static str {
    use objc2_foundation::{ns_string, NSBundle, NSString};
    use std::sync::OnceLock;

    static AGENT: OnceLock<String> = OnceLock::new();
    AGENT.get_or_init(|| {
        let version = NSBundle::bundleWithPath(ns_string!("/Applications/Safari.app"))
            .and_then(|bundle| {
                bundle.objectForInfoDictionaryKey(ns_string!("CFBundleShortVersionString"))
            })
            .and_then(|value| value.downcast::<NSString>().ok())
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "26.0".to_string());
        format!(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/{version} Safari/605.1.15"
        )
    })
}

fn page_url(value: &str) -> Result<Url, String> {
    let parsed = Url::parse(value).map_err(|_| "Invalid browser URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Browser tabs accept only HTTP and HTTPS URLs".into());
    }
    Ok(parsed)
}

fn page_label(owner: &str, tab_id: &str) -> Result<String, String> {
    label(tab_id)?;
    Ok(format!("browser-{owner}--{tab_id}"))
}

fn page(app: &AppHandle, caller: &Webview, tab_id: &str) -> Result<Webview, String> {
    let view = app
        .get_webview(&page_label(caller.label(), tab_id)?)
        .ok_or_else(|| "Browser tab is not open".to_string())?;
    if view.window().label() != caller.window().label() {
        return Err("Browser tab belongs to another workspace".into());
    }
    Ok(view)
}

/// Tauri's child webview builder runs on the UI thread. Keep this command async:
/// creating one from a synchronous command can deadlock WebView2 on Windows.
#[tauri::command]
pub(crate) async fn browser_open(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    require_main(&caller)?;
    let view_label = page_label(caller.label(), &tab_id)?;
    let target = page_url(&url)?;
    if app.get_webview(&view_label).is_some() {
        return Ok(());
    }
    let window = caller.window();
    let nav_owner = caller.label().to_string();
    let title_owner = nav_owner.clone();
    let popup_owner = nav_owner.clone();
    let nav_app = app.clone();
    let nav_id = tab_id.clone();
    let title_app = app.clone();
    let title_id = tab_id.clone();
    let popup_app = app.clone();
    let popup_id = tab_id;
    // Establish the platform appearance before the destination's first script runs.
    let builder = WebviewBuilder::new(
        view_label.clone(),
        WebviewUrl::External(Url::parse("about:blank").expect("valid browser blank URL")),
    );
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(safari_user_agent());
    let builder = builder
        .on_navigation(|next| matches!(next.scheme(), "http" | "https" | "about"))
        .on_page_load(move |_view, payload| {
            let _ = nav_app.emit_to(
                &nav_owner,
                "browser:navigated",
                BrowserPageEvent {
                    tab_id: nav_id.clone(),
                    url: payload.url().to_string(),
                    title: None,
                    loading: matches!(payload.event(), PageLoadEvent::Started),
                },
            );
        })
        .on_document_title_changed(move |view, title| {
            let _ = title_app.emit_to(
                &title_owner,
                "browser:title",
                BrowserPageEvent {
                    tab_id: title_id.clone(),
                    url: view.url().map(|url| url.to_string()).unwrap_or_default(),
                    title: Some(title),
                    loading: false,
                },
            );
        })
        .on_new_window(move |next, _features| {
            if matches!(next.scheme(), "http" | "https") {
                let _ = popup_app.emit_to(
                    &popup_owner,
                    "browser:popup",
                    BrowserPageEvent {
                        tab_id: popup_id.clone(),
                        url: next.to_string(),
                        title: None,
                        loading: false,
                    },
                );
            }
            NewWindowResponse::Deny
        });
    let view = match window.add_child(
        builder,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(1.0, 1.0),
    ) {
        Ok(view) => view,
        Err(_) if app.get_webview(&view_label).is_some() => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let theme = BROWSER_THEME
        .lock()
        .ok()
        .and_then(|current| current.clone())
        .unwrap_or_else(|| {
            if crate::prefs::load_theme_is_dark(&app) == Some(false) {
                "light".to_string()
            } else {
                "dark".to_string()
            }
        });
    apply_theme_to_view(&view, &theme)?;
    view.hide().map_err(|error| error.to_string())?;
    view.navigate(target).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn browser_bounds(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    require_main(&caller)?;
    let view = page(&app, &caller, &tab_id)?;
    if !bounds.visible || bounds.width < 1.0 || bounds.height < 1.0 {
        return view.hide().map_err(|error| error.to_string());
    }
    if ![bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("Invalid browser bounds".into());
    }
    // Frame first, then show, so a page revealed after a resize never paints at its previous
    // rectangle. Framing and showing is all this does: the view keeps its place above the app
    // view, and is never reordered or re-inserted (see `BrowserBounds`).
    let (x, y, width, height) = css_to_logical(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        app_zoom(&app),
    );
    view.set_bounds(tauri::Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(width, height).into(),
    })
    .map_err(|error| error.to_string())?;
    view.show().map_err(|error| error.to_string())
}

/// The app view's page zoom (View ▸ Zoom), as last applied.
fn app_zoom(app: &AppHandle) -> f64 {
    *app.state::<crate::prefs::ZoomState>().0.lock().unwrap()
}

/// A rectangle the app page measured, in CSS pixels, as window points.
///
/// The app view runs under page zoom, which makes one CSS pixel `zoom` points. The page reports
/// `getBoundingClientRect`, so at 125% zoom a pane measured 400 CSS px wide is 500 points on
/// screen — and framing the native page with the raw numbers left it smaller than its pane and
/// shifted toward the window's corner. The snapshot of a workbench region already scaled by the
/// zoom; framing a page now goes through the same conversion, so the two cannot disagree.
fn css_to_logical(x: f64, y: f64, width: f64, height: f64, zoom: f64) -> (f64, f64, f64, f64) {
    let zoom = if zoom.is_finite() && zoom > 0.0 {
        zoom
    } else {
        1.0
    };
    (x * zoom, y * zoom, width * zoom, height * zoom)
}

#[tauri::command]
pub(crate) fn browser_navigate(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    require_main(&caller)?;
    page(&app, &caller, &tab_id)?
        .navigate(page_url(&url)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn browser_reload(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
) -> Result<(), String> {
    require_main(&caller)?;
    page(&app, &caller, &tab_id)?
        .reload()
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserNavigationState {
    can_go_back: bool,
    can_go_forward: bool,
    /// A main-frame load is in flight, so the document now in the page is about to be replaced.
    /// WebKit's own answer, not one inferred from comparing addresses: a page that rewrites its
    /// URL with `history.replaceState` never matches the address the tab last loaded.
    loading: bool,
}

#[tauri::command]
pub(crate) async fn browser_navigation_state(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
) -> Result<BrowserNavigationState, String> {
    require_main(&caller)?;
    let view = page(&app, &caller, &tab_id)?;
    #[cfg(target_os = "macos")]
    {
        use objc2_web_kit::WKWebView;
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |platform| {
            let webview: &WKWebView = unsafe { &*platform.inner().cast() };
            let _ = tx.send(BrowserNavigationState {
                can_go_back: unsafe { webview.canGoBack() },
                can_go_forward: unsafe { webview.canGoForward() },
                loading: unsafe { webview.isLoading() },
            });
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(2))
                .map_err(|_| "Browser navigation state timed out".to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = view;
        Ok(BrowserNavigationState {
            can_go_back: true,
            can_go_forward: true,
            loading: false,
        })
    }
}

#[tauri::command]
pub(crate) fn browser_go(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    direction: String,
) -> Result<(), String> {
    require_main(&caller)?;
    if !matches!(direction.as_str(), "back" | "forward") {
        return Err("Invalid browser history direction".into());
    }
    let view = page(&app, &caller, &tab_id)?;
    #[cfg(target_os = "macos")]
    {
        use objc2_web_kit::WKWebView;
        view.with_webview(move |platform| {
            let webview: &WKWebView = unsafe { &*platform.inner().cast() };
            if direction == "back" {
                unsafe { webview.goBack() };
            } else {
                unsafe { webview.goForward() };
            }
        })
        .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        view.eval(if direction == "back" {
            "history.back()"
        } else {
            "history.forward()"
        })
        .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub(crate) fn browser_close_many(
    app: AppHandle,
    caller: Webview,
    tab_ids: Vec<String>,
) -> Result<(), String> {
    require_main(&caller)?;
    if tab_ids.len() > 100 {
        return Err("Too many browser tabs in one close request".into());
    }
    let labels = tab_ids
        .iter()
        .map(|tab_id| page_label(caller.label(), tab_id))
        .collect::<Result<Vec<_>, _>>()?;
    for view_label in labels {
        if let Some(view) = app.get_webview(&view_label) {
            view.close().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

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
enum Capture {
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

/// Capture a rectangle of the calling main view — a plugin panel the agent asked to see.
#[tauri::command]
pub(crate) async fn workbench_snapshot(
    app: AppHandle,
    caller: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<BrowserImage, String> {
    require_main(&caller)?;
    if !(width.is_finite() && height.is_finite() && width >= 1.0 && height >= 1.0) {
        return Err("The region to capture is empty".into());
    }
    // The page measures in CSS pixels and the snapshot rectangle is in points (`css_to_logical`).
    let (x, y, width, height) = css_to_logical(x, y, width, height, app_zoom(&app));
    capture(
        caller,
        Capture::Region {
            x,
            y,
            width,
            height,
        },
        Duration::from_secs(12),
    )
    .await
}

/// Capture compositor pixels from the native page, not a DOM-to-SVG rerender.
/// The latter can succeed with an all-black image on external sites.
#[tauri::command]
pub(crate) async fn browser_snapshot(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
) -> Result<BrowserImage, String> {
    require_main(&caller)?;
    capture(
        page(&app, &caller, &tab_id)?,
        Capture::Exact,
        Duration::from_secs(12),
    )
    .await
}

/// The picture the UI paints in the page's place while an app overlay is on screen.
#[tauri::command]
pub(crate) async fn browser_placeholder(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
) -> Result<BrowserImage, String> {
    require_main(&caller)?;
    capture(
        page(&app, &caller, &tab_id)?,
        Capture::Placeholder,
        Duration::from_secs(2),
    )
    .await
}

#[cfg(target_os = "macos")]
async fn capture(view: Webview, kind: Capture, timeout: Duration) -> Result<BrowserImage, String> {
    use base64::Engine;
    use objc2::{runtime::AnyObject, AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageCompressionFactor,
    };
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

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
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(timeout)
            .map_err(|_| "Browser snapshot timed out".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn capture(view: Webview, kind: Capture, timeout: Duration) -> Result<BrowserImage, String> {
    let _ = (view, kind, timeout);
    Err("Native browser screenshots are not yet supported on this platform".into())
}

/// A result-bearing bridge for a bounded DOM observation or action. The caller
/// supplies the script; the website has no access to this command or its result.
#[tauri::command]
pub(crate) async fn browser_eval(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    script: String,
) -> Result<String, String> {
    require_main(&caller)?;
    if script.len() > 128_000 {
        return Err("Browser script is too large".into());
    }
    let view = page(&app, &caller, &tab_id)?;

    #[cfg(target_os = "macos")]
    {
        use objc2::{runtime::AnyObject, AnyThread};
        use objc2_foundation::{
            NSError, NSJSONSerialization, NSJSONWritingOptions, NSString, NSUTF8StringEncoding,
        };
        use objc2_web_kit::WKWebView;

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        view.with_webview(move |platform| {
            // Wry discards NSError and returns an empty string when evaluation
            // fails. Keep the platform WebView and its capability boundary, but
            // expose the actual WebKit error to the trusted main UI.
            let webview: &WKWebView = unsafe { &*platform.inner().cast() };
            let callback =
                block2::RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                    let result = if !error.is_null() {
                        let error = unsafe { &*error };
                        Err(format!(
                            "{} (domain: {}, code: {}, details: {:?})",
                            error.localizedDescription(),
                            error.domain(),
                            error.code(),
                            error.userInfo().description(),
                        ))
                    } else if value.is_null() {
                        Ok(String::new())
                    } else {
                        unsafe {
                            NSJSONSerialization::dataWithJSONObject_options_error(
                                &*value,
                                NSJSONWritingOptions::FragmentsAllowed,
                            )
                        }
                        .map_err(|error| error.localizedDescription().to_string())
                        .and_then(|data| {
                            NSString::initWithData_encoding(
                                NSString::alloc(),
                                &data,
                                NSUTF8StringEncoding,
                            )
                            .map(|value| value.to_string())
                            .ok_or_else(|| "WebKit returned non-UTF8 JavaScript data".to_string())
                        })
                    };
                    let _ = tx.send(result);
                });
            unsafe {
                webview.evaluateJavaScript_completionHandler(
                    &NSString::from_str(&script),
                    Some(&callback),
                );
            }
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(10))
                .map_err(|_| "Browser page did not answer".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let (tx, rx) = mpsc::channel();
        view.eval_with_callback(script, move |result| {
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(10))
                .map_err(|_| "Browser page did not answer".to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }
}

#[tauri::command]
pub(crate) fn browser_inject(
    app: AppHandle,
    caller: Webview,
    tab_id: String,
    script: String,
) -> Result<(), String> {
    require_main(&caller)?;
    if script.len() > 128_000 {
        return Err("Browser script is too large".into());
    }
    page(&app, &caller, &tab_id)?
        .eval(script)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{css_to_logical, label, page_url};

    #[test]
    fn a_measured_pane_is_framed_at_its_zoomed_size() {
        assert_eq!(
            css_to_logical(40.0, 80.0, 400.0, 300.0, 1.25),
            (50.0, 100.0, 500.0, 375.0)
        );
        assert_eq!(
            css_to_logical(40.0, 80.0, 400.0, 300.0, 1.0),
            (40.0, 80.0, 400.0, 300.0)
        );
        // A corrupt zoom must not collapse or explode the frame.
        assert_eq!(
            css_to_logical(1.0, 2.0, 3.0, 4.0, 0.0),
            (1.0, 2.0, 3.0, 4.0)
        );
        assert_eq!(
            css_to_logical(1.0, 2.0, 3.0, 4.0, f64::NAN),
            (1.0, 2.0, 3.0, 4.0)
        );
    }

    #[test]
    fn native_tab_ids_are_opaque_and_safe_as_labels() {
        assert!(label("550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(label("https://example.com").is_err());
    }

    #[test]
    fn browser_navigation_rejects_local_and_app_schemes() {
        assert!(page_url("https://example.com/a").is_ok());
        assert!(page_url("file:///private/key").is_err());
        assert!(page_url("tauri://localhost/").is_err());
    }

    /// The tokens sites sniff for must be present, or they serve the page to an unknown browser.
    #[cfg(target_os = "macos")]
    #[test]
    fn pages_introduce_themselves_as_the_installed_safari() {
        let agent = super::safari_user_agent();
        assert!(agent.starts_with("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "));
        assert!(agent.contains("AppleWebKit/605.1.15 (KHTML, like Gecko) Version/"));
        assert!(agent.ends_with(" Safari/605.1.15"));
    }
}
