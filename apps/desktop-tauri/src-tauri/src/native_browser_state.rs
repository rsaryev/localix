//! What a native page shows — its address, whether a load is in flight and its history — kept
//! current for the workbench without polling.
//!
//! wry reports a load only when it commits and when it finishes. A single-page app that changes
//! its route with `history.pushState` never loads, and a load that fails before it commits
//! reports nothing, so the address bar, the loading bar and back/forward fell behind the page. On
//! macOS WebKit's own properties are observed (KVO) and every change is told as
//! `browser:navigated`. Elsewhere the commit and finish events are all there is, and a navigation
//! the workbench asked for counts as loading until one of them arrives (`LoadTracker`), so an
//! agent command never reads the document the page is leaving.

use serde::Serialize;

/// `browser:navigated`: the page's current state. History flags are sent only where they are
/// known (macOS); without them the workbench asks with `browser_navigation_state`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct PageState {
    pub(crate) tab_id: String,
    pub(crate) url: String,
    pub(crate) loading: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) can_go_back: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) can_go_forward: Option<bool>,
}

#[cfg(target_os = "macos")]
pub(crate) use observe::{address, forget, forget_owner, observe};

#[cfg(target_os = "macos")]
mod observe {
    use super::PageState;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly, Message};
    use objc2_foundation::{NSDictionary, NSKeyValueChangeKey, NSObject, NSString};
    use objc2_web_kit::WKWebView;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use tauri::{AppHandle, Emitter};

    const KEYS: [&str; 4] = ["URL", "loading", "canGoBack", "canGoForward"];

    struct Context {
        app: AppHandle,
        owner: String,
        tab_id: String,
        view: Retained<WKWebView>,
        last: RefCell<Option<PageState>>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = Context]
        struct PageObserver;
        unsafe impl NSObjectProtocol for PageObserver {}
        impl PageObserver {
            #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
            fn observe(&self, _key: Option<&NSString>, _object: Option<&AnyObject>,
                _change: Option<&NSDictionary<NSKeyValueChangeKey, AnyObject>>, _context: *mut c_void) {
                // KVO arrives inside WebKit's own callouts, and one navigation changes several
                // properties at once: report once, after them, outside the callout.
                let label = crate::native_browser::page_label(
                    &self.ivars().owner,
                    &self.ivars().tab_id,
                );
                if let Ok(label) = label {
                    crate::main_queue::defer(move || report(&label));
                }
            }
        }
    );

    thread_local! {
        static OBSERVERS: RefCell<HashMap<String, Retained<PageObserver>>> = RefCell::new(HashMap::new());
    }

    /// The page's address, or empty while it has none. Not `Webview::url()`: wry unwraps WebKit's
    /// `URL`, which is nil in a page whose first load failed, and the shell panicked.
    pub(crate) fn address(view: &WKWebView) -> String {
        let url: Option<Retained<AnyObject>> = unsafe { msg_send![view, URL] };
        let url: Option<Retained<NSString>> =
            url.and_then(|url| unsafe { msg_send![&*url, absoluteString] });
        url.map(|url| url.to_string()).unwrap_or_default()
    }

    fn read(view: &WKWebView, tab_id: &str) -> PageState {
        PageState {
            tab_id: tab_id.to_string(),
            url: address(view),
            loading: unsafe { view.isLoading() },
            can_go_back: Some(unsafe { view.canGoBack() }),
            can_go_forward: Some(unsafe { view.canGoForward() }),
        }
    }

    fn report(label: &str) {
        OBSERVERS.with(|observers| {
            let observers = observers.borrow();
            let Some(observer) = observers.get(label) else {
                return;
            };
            let context = observer.ivars();
            let state = read(&context.view, &context.tab_id);
            // `about:blank` is where every page starts; it is never an address to show.
            if !state.url.starts_with("http") || context.last.borrow().as_ref() == Some(&state) {
                return;
            }
            let _ = context
                .app
                .emit_to(&context.owner, "browser:navigated", state.clone());
            *context.last.borrow_mut() = Some(state);
        });
    }

    /// Follow a page created on the main thread for as long as it exists.
    pub(crate) fn observe(app: &AppHandle, owner: &str, tab_id: &str, view: &WKWebView) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(label) = crate::native_browser::page_label(owner, tab_id) else {
            return;
        };
        forget(&label);
        let observer = PageObserver::alloc(mtm).set_ivars(Context {
            app: app.clone(),
            owner: owner.into(),
            tab_id: tab_id.into(),
            view: view.retain(),
            last: RefCell::new(None),
        });
        let observer: Retained<PageObserver> = unsafe { msg_send![super(observer), init] };
        for key in KEYS {
            unsafe {
                let _: () = msg_send![view, addObserver: &*observer, forKeyPath: &*NSString::from_str(key), options: 0usize, context: std::ptr::null_mut::<c_void>()];
            }
        }
        OBSERVERS.with(|observers| observers.borrow_mut().insert(label, observer));
    }

    /// Stop following a page that is being closed. Called on the main thread.
    pub(crate) fn forget(label: &str) {
        let observer = OBSERVERS.with(|observers| observers.borrow_mut().remove(label));
        if let Some(observer) = observer {
            for key in KEYS {
                unsafe {
                    let _: () = msg_send![&*observer.ivars().view, removeObserver: &*observer, forKeyPath: &*NSString::from_str(key)];
                }
            }
        }
    }

    /// Stop following every page of a window that is gone.
    pub(crate) fn forget_owner(owner: &str) {
        let prefix = format!("browser-{owner}--");
        crate::main_queue::defer(move || {
            let labels: Vec<String> = OBSERVERS.with(|observers| {
                observers
                    .borrow()
                    .keys()
                    .filter(|label| label.starts_with(&prefix))
                    .cloned()
                    .collect()
            });
            for label in labels {
                forget(&label);
            }
        });
    }
}

/// How long a requested navigation counts as loading before anything is heard from it. A request
/// that never commits (a refused connection on some engines) must not hold commands for longer.
#[cfg_attr(target_os = "macos", allow(dead_code))]
const REQUEST_GRACE: std::time::Duration = std::time::Duration::from_secs(15);

/// Loads in flight where the engine cannot be asked (Windows, Linux): from the workbench's own
/// request, through the commit, until the load finishes or fails.
#[derive(Default)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) struct LoadTracker(
    std::sync::Mutex<std::collections::HashMap<String, Option<std::time::Instant>>>,
);

#[cfg_attr(target_os = "macos", allow(dead_code))]
impl LoadTracker {
    /// The workbench asked the page to navigate, reload or move through its history.
    pub(crate) fn requested(&self, label: &str, now: std::time::Instant) {
        self.0.lock().unwrap().insert(label.into(), Some(now));
    }

    /// A load committed: it is in flight until it finishes, whenever that is.
    pub(crate) fn committed(&self, label: &str) {
        self.0.lock().unwrap().insert(label.into(), None);
    }

    /// The load finished (a failed load finishes too).
    pub(crate) fn finished(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }

    pub(crate) fn loading(&self, label: &str, now: std::time::Instant) -> bool {
        match self.0.lock().unwrap().get(label) {
            Some(Some(requested)) => now.duration_since(*requested) < REQUEST_GRACE,
            Some(None) => true,
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const PAGE: &str = "browser-main--page-1234";

    #[test]
    fn a_requested_navigation_is_loading_until_the_page_finishes_it() {
        let loads = LoadTracker::default();
        let now = Instant::now();
        assert!(!loads.loading(PAGE, now));
        loads.requested(PAGE, now);
        assert!(loads.loading(PAGE, now + Duration::from_secs(1)));
        loads.committed(PAGE);
        assert!(loads.loading(PAGE, now + Duration::from_secs(60)));
        loads.finished(PAGE);
        assert!(!loads.loading(PAGE, now));
    }

    #[test]
    fn a_request_that_is_never_heard_from_stops_counting_as_loading() {
        let loads = LoadTracker::default();
        let now = Instant::now();
        loads.requested(PAGE, now);
        assert!(!loads.loading(PAGE, now + REQUEST_GRACE));
    }

    #[test]
    fn page_state_omits_history_it_does_not_know() {
        let state = PageState {
            tab_id: "page-1234".into(),
            url: "https://example.com/".into(),
            loading: false,
            can_go_back: None,
            can_go_forward: None,
        };
        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::json!({ "tabId": "page-1234", "url": "https://example.com/", "loading": false })
        );
    }
}
