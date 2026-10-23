//! What a standalone mini app's page may ask of the window: a link out, a file to open, an alert or
//! a confirmation. WebKit does none of these on its own; without a delegate a `<input type=file>`
//! or a `confirm()` silently does nothing.
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol};
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSModalResponseOK, NSOpenPanel, NSWorkspace,
};
use objc2_foundation::{NSArray, NSString, NSURL};
use objc2_web_kit::{
    WKFrameInfo, WKNavigationAction, WKOpenPanelParameters, WKUIDelegate, WKWebView,
    WKWebViewConfiguration, WKWindowFeatures,
};

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LocalixMiniAppPageUi"]
    pub(crate) struct PageUi;

    unsafe impl NSObjectProtocol for PageUi {}

    unsafe impl WKUIDelegate for PageUi {
        /// `window.open` and `target=_blank` never make a second, unmanaged window: a web
        /// address opens in the browser, as it does from the workspace.
        #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create_web_view(
            &self,
            _web_view: &WKWebView,
            _configuration: &WKWebViewConfiguration,
            action: &WKNavigationAction,
            _features: &WKWindowFeatures,
        ) -> Option<Retained<WKWebView>> {
            if let Some(url) = unsafe { action.request() }
                .URL()
                .and_then(|url| url.absoluteString())
            {
                let url = url.to_string();
                if is_web(&url) {
                    open_external(&url);
                }
            }
            None
        }

        #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
        fn run_open_panel(
            &self,
            _web_view: &WKWebView,
            parameters: &WKOpenPanelParameters,
            _frame: &WKFrameInfo,
            completion: &block2::DynBlock<dyn Fn(*mut NSArray<NSURL>)>,
        ) {
            let Some(mtm) = MainThreadMarker::new() else {
                completion.call((std::ptr::null_mut(),));
                return;
            };
            let panel = NSOpenPanel::openPanel(mtm);
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(unsafe { parameters.allowsDirectories() });
            panel.setAllowsMultipleSelection(unsafe { parameters.allowsMultipleSelection() });
            if panel.runModal() == NSModalResponseOK {
                let urls = panel.URLs();
                completion.call((Retained::as_ptr(&urls) as *mut NSArray<NSURL>,));
            } else {
                completion.call((std::ptr::null_mut(),));
            }
        }

        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn run_alert(
            &self,
            _web_view: &WKWebView,
            message: &NSString,
            _frame: &WKFrameInfo,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            if let Some(mtm) = MainThreadMarker::new() {
                alert(mtm, message, &["OK"]);
            }
            completion.call(());
        }

        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn run_confirm(
            &self,
            _web_view: &WKWebView,
            message: &NSString,
            _frame: &WKFrameInfo,
            completion: &block2::DynBlock<dyn Fn(Bool)>,
        ) {
            let confirmed = MainThreadMarker::new().is_some_and(|mtm| {
                alert(mtm, message, &["OK", "Cancel"]) == NSAlertFirstButtonReturn
            });
            completion.call((Bool::new(confirmed),));
        }
    }
);

impl PageUi {
    pub(crate) fn new(mtm: MainThreadMarker) -> Retained<Self> {
        unsafe { msg_send![Self::alloc(mtm), init] }
    }
}

fn alert(mtm: MainThreadMarker, message: &NSString, buttons: &[&str]) -> isize {
    let alert = NSAlert::new(mtm);
    alert.setMessageText(message);
    for title in buttons {
        alert.addButtonWithTitle(&NSString::from_str(title));
    }
    alert.runModal()
}

pub(crate) fn is_web(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

pub(crate) fn open_external(url: &str) {
    if let Some(url) = NSURL::URLWithString(&NSString::from_str(url)) {
        NSWorkspace::sharedWorkspace().openURL(&url);
    }
}
