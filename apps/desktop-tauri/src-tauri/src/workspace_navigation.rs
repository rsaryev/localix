//! Where a navigation in a workspace's own webview goes: loaded there, refused, handed to the OS,
//! or handed to the UI because a preview frame is leaving for another site.
//!
//! The workspace webview hosts the app and, inside it, each preview as an iframe on a loopback
//! server. A preview page that heads for a non-loopback document (an OAuth provider, which also
//! refuses framing) must not replace the app, and used to open the system browser — outside the
//! preview, so the sign-in never came back to it. What the handler is told, from the sources of
//! the pinned versions:
//!
//!   - macOS: wry 0.55.1 `wkwebview/navigation.rs` `navigation_policy` serves
//!     `webView:decidePolicyForNavigationAction:` for EVERY frame, redirects included, and passes
//!     the request URL alone; `WKNavigationAction.targetFrame` is never read.
//!   - Linux: wry `webkitgtk/mod.rs` answers `decide-policy` for `NavigationAction` decisions,
//!     which WebKitGTK raises for the main frame and subframes alike, again with the URI alone.
//!   - Windows: wry `webview2/mod.rs` subscribes to `NavigationStarting`, which WebView2 raises
//!     for the MAIN frame only; a frame's navigations raise `FrameNavigationStarting`, which wry
//!     does not subscribe to. Every web address the handler sees there is the top document's.
//!
//! tauri-runtime-wry 2.11.4 parses that string and calls `on_navigation(&Url)`. So the shell
//! cannot tell which frame, or whether a frame at all, is navigating. Where frames reach the
//! handler it cancels the navigation and tells the UI the address (`FRAME_NAVIGATION_EVENT`);
//! the UI knows which preview frame the person is working in and switches that tab to its native
//! page (`apps/ui/src/features/inspector/model/previewFrameNavigation.ts`), or asks before the
//! system browser.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Url};

use crate::deeplink::{is_embedded_navigation_url, is_external_url, is_internal_url, is_loopback};

/// The UI's event for a navigation the shell cancelled and could not attribute.
pub(crate) const FRAME_NAVIGATION_EVENT: &str = "browser:frame-navigation";

/// Whether the platform's navigation handler sees the navigations of frames (see the module
/// note): WKWebView and WebKitGTK do, WebView2's `NavigationStarting` does not.
pub(crate) const HANDLER_SEES_FRAMES: bool = cfg!(not(target_os = "windows"));

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Navigation {
    /// The app, a loopback page (the preview frames) or a generated document: load it here.
    Load,
    /// `file:`, `javascript:` and unknown schemes.
    Refuse,
    /// A link for the OS handler: mail, a phone call, or a web page where no frame can be the one
    /// navigating.
    OpenExternally,
    /// A web page that may be a preview frame's: cancel it and let the UI decide.
    AskUi,
}

/// The decision for one navigation; `sees_frames` is `HANDLER_SEES_FRAMES` for a navigation and
/// false for a new window, which never replaces a frame's own document.
pub(crate) fn decide(url: &Url, sees_frames: bool) -> Navigation {
    if is_internal_url(url) || is_loopback(url) || is_embedded_navigation_url(url) {
        return Navigation::Load;
    }
    if !is_external_url(url) {
        return Navigation::Refuse;
    }
    // `is_external_url` gives a web address a host; the app's own origin is internal above, so
    // what reaches the UI is a remote page the native page's own rules then apply to.
    if sees_frames && matches!(url.scheme(), "http" | "https") {
        Navigation::AskUi
    } else {
        Navigation::OpenExternally
    }
}

#[derive(Clone, Serialize)]
struct FrameNavigation {
    url: String,
}

fn payload(url: &Url) -> FrameNavigation {
    FrameNavigation {
        url: url.to_string(),
    }
}

/// Tell the workspace's UI where a cancelled navigation was going. Only the workspace that owns
/// the webview hears it; the address is page content, which the UI checks again.
pub(crate) fn hand_to_ui(app: &AppHandle, workspace: &str, url: &Url) {
    let _ = app.emit_to(workspace, FRAME_NAVIGATION_EVENT, payload(url));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decided(value: &str, sees_frames: bool) -> Navigation {
        decide(&Url::parse(value).expect("test URL parses"), sees_frames)
    }

    #[test]
    fn a_sign_in_page_is_the_uis_question_where_frames_reach_the_handler() {
        for url in [
            "https://accounts.google.com/o/oauth2/v2/auth?client_id=app&state=xyz",
            "http://idp.example.org/login",
            // A LAN address is not this machine: it is a remote page for a native tab.
            "http://192.168.1.20:3000/",
        ] {
            assert_eq!(decided(url, true), Navigation::AskUi, "{url}");
            // Windows: the handler only ever sees the top document, which is the app's UI.
            assert_eq!(decided(url, false), Navigation::OpenExternally, "{url}");
        }
    }

    #[test]
    fn the_app_and_loopback_pages_load_in_place() {
        for sees_frames in [true, false] {
            for url in [
                "tauri://localhost/index.html",
                // The packaged app's origin on Windows is the app, never a page for a tab.
                "http://tauri.localhost/index.html",
                "http://127.0.0.1:61234/preview",
                "http://localhost:3000/callback?code=1",
                "http://[::1]:5173/",
                "about:blank",
                "data:text/html,hello",
            ] {
                assert_eq!(decided(url, sees_frames), Navigation::Load, "{url}");
            }
        }
    }

    #[test]
    fn mail_and_calls_go_to_the_os_and_other_schemes_are_refused() {
        for sees_frames in [true, false] {
            assert_eq!(
                decided("mailto:hello@localix.dev", sees_frames),
                Navigation::OpenExternally
            );
            assert_eq!(
                decided("tel:+35799123456", sees_frames),
                Navigation::OpenExternally
            );
            for url in [
                "file:///etc/passwd",
                "javascript:alert(1)",
                "localix://open?path=/etc",
                "ftp://example.com/file",
            ] {
                assert_eq!(decided(url, sees_frames), Navigation::Refuse, "{url}");
            }
        }
    }

    #[test]
    fn the_ui_is_told_the_address_alone() {
        let url = Url::parse("https://accounts.google.com/o?state=a\"b").unwrap();
        assert_eq!(
            serde_json::to_value(payload(&url)).unwrap(),
            serde_json::json!({ "url": "https://accounts.google.com/o?state=a%22b" })
        );
    }
}
