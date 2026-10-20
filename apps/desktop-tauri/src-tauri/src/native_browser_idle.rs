//! What a native Browser page does while nobody sees it.
//!
//! Hiding already stops a page drawing: measured in a background tab, WebKit reports
//! `visibilityState: hidden`, runs no animation frames and fires a 10 ms timer about five times a
//! second. Two things it does not do on its own are handled here:
//!
//! - **Media.** A hidden page keeps playing audio and video. Playback is suspended while the page
//!   is hidden and resumed when it is shown (`setAllMediaPlaybackSuspended`, always in pairs).
//! - **Its size.** A page opened in the background used to be created 1×1 and stay so until a
//!   pane showed it: the site laid itself out for a 1-pixel viewport (every control "off screen",
//!   phone layouts, element screenshots of nothing) for as long as the agent drove it unseen. It
//!   is now created at the window's size, the closest stand-in for the pane it will show in.

use tauri::{LogicalSize, Webview, Window};

/// The smallest viewport a page is laid out at while it has never been shown.
const MIN_HIDDEN_WIDTH: f64 = 1024.0;
const MIN_HIDDEN_HEIGHT: f64 = 720.0;

/// The size a page is created at before any pane frames it: the window's, at least a laptop's.
pub(crate) fn hidden_page_size(window: &Window) -> LogicalSize<f64> {
    let logical = window.inner_size().ok().and_then(|size| {
        let scale = window.scale_factor().ok()?;
        Some(size.to_logical::<f64>(scale))
    });
    let (width, height) = logical.map_or((0.0, 0.0), |size| (size.width, size.height));
    LogicalSize::new(width.max(MIN_HIDDEN_WIDTH), height.max(MIN_HIDDEN_HEIGHT))
}

/// Pages whose media is suspended now. Hide and show arrive on every bounds update, while
/// WebKit wants one resume per suspend, so only a change of state reaches it.
static SUSPENDED: std::sync::Mutex<Option<std::collections::HashSet<String>>> =
    std::sync::Mutex::new(None);

/// Whether `label` changes state: true when it was not already `suspended`.
fn transition(label: &str, suspended: bool) -> bool {
    let mut guard = SUSPENDED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let set = guard.get_or_insert_with(Default::default);
    if suspended {
        set.insert(label.to_string())
    } else {
        set.remove(label)
    }
}

/// The page left the screen (`true`) or came back (`false`): suspend or resume its media.
/// Best effort — a page without media is unaffected.
pub(crate) fn page_hidden(view: &Webview, hidden: bool) {
    if !transition(view.label(), hidden) {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_web_kit::WKWebView;
        let _ = view.with_webview(move |platform| {
            let webview: &WKWebView = unsafe { &*platform.inner().cast() };
            unsafe { webview.setAllMediaPlaybackSuspended_completionHandler(hidden, None) };
        });
    }
}

/// A closed page leaves no state behind.
pub(crate) fn forget(label: &str) {
    transition(label, false);
}

#[cfg(test)]
mod tests {
    #[test]
    fn media_is_suspended_and_resumed_once_per_change() {
        assert!(super::transition("t:a", true));
        assert!(!super::transition("t:a", true));
        assert!(super::transition("t:a", false));
        assert!(!super::transition("t:a", false));
    }

    #[test]
    fn a_never_shown_page_is_laid_out_at_least_at_a_laptop_viewport() {
        const { assert!(super::MIN_HIDDEN_WIDTH >= 1024.0 && super::MIN_HIDDEN_HEIGHT >= 720.0) };
    }
}
