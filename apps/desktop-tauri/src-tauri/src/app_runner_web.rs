//! A plugin app's one window: its page, where that page may go, and what it may ask of the app.
use std::cell::{Cell, OnceCell};
use std::time::Instant;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication,
    NSApplicationDelegate, NSWindow, NSWindowDelegate,
};
use objc2_foundation::{NSString, NSURL};
use objc2_web_kit::{
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKScriptMessage,
    WKScriptMessageHandler, WKUserContentController, WKWebView, WKWebViewConfiguration,
};

use crate::app_runner::{Config, Ui, PAGE_ORIGIN, SCHEME};
use crate::app_runner_host as host;
use crate::app_runner_ui::{is_web, open_external, PageUi};
use crate::window_material::Appearance;

/// The page posts JSON strings to `window.webkit.messageHandlers.localixApp`.
pub(crate) const MESSAGE_HANDLER: &str = "localixApp";

pub(crate) struct State {
    pub(crate) config: Config,
    pub(crate) window: OnceCell<Retained<NSWindow>>,
    pub(crate) web_view: OnceCell<Retained<WKWebView>>,
    pub(crate) glass: OnceCell<Retained<objc2_app_kit::NSVisualEffectView>>,
    /// The web view holds its UI delegate weakly; this is what keeps it.
    pub(crate) page_ui: OnceCell<Retained<PageUi>>,
    /// The runtime port the loaded page talks to; `None` until Localix answers.
    pub(crate) port: Cell<Option<u16>>,
    /// Since when the app has been waiting for a runtime to answer; `None` while connected.
    pub(crate) waiting_since: Cell<Option<Instant>>,
    /// This wait already asked macOS to start Localix.
    pub(crate) asked_host: Cell<bool>,
    /// This wait outlasted the limit and said so.
    pub(crate) gave_up: Cell<bool>,
    /// The conversation the page shows, for **Open in Localix**.
    pub(crate) session: std::cell::RefCell<Option<String>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = State]
    #[name = "LocalixPluginAppController"]
    pub(crate) struct Controller;

    unsafe impl NSObjectProtocol for Controller {}

    unsafe impl NSApplicationDelegate for Controller {
        /// Launched from the Dock, Spotlight or Finder, the app comes forward like any other.
        #[unsafe(method(applicationDidFinishLaunching:))]
        fn did_finish_launching(&self, _notification: &objc2_foundation::NSNotification) {
            if let Some(mtm) = MainThreadMarker::new() {
                #[allow(deprecated)]
                NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            }
            if let Some(window) = self.ivars().window.get() {
                window.makeKeyAndOrderFront(None);
            }
        }

        #[unsafe(method(applicationShouldTerminateAfterLastWindowClosed:))]
        fn terminate_after_last_window(&self, _app: &NSApplication) -> bool {
            true
        }
    }

    unsafe impl NSWindowDelegate for Controller {
        #[unsafe(method(windowDidEnterFullScreen:))]
        fn did_enter_full_screen(&self, _notification: &objc2_foundation::NSNotification) {
            self.lay_out_title_row();
        }

        #[unsafe(method(windowDidExitFullScreen:))]
        fn did_exit_full_screen(&self, _notification: &objc2_foundation::NSNotification) {
            self.lay_out_title_row();
        }
    }

    unsafe impl WKNavigationDelegate for Controller {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_navigation(
            &self,
            _web_view: &WKWebView,
            action: &WKNavigationAction,
            decision: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            let main_frame = unsafe { action.targetFrame() }
                .is_some_and(|frame| unsafe { frame.isMainFrame() });
            let url = unsafe { action.request() }.URL();
            let policy = match url.as_deref().and_then(absolute) {
                // A link that leaves the app opens in the browser, like it does in the workspace.
                Some(url) if main_frame && !self.owns(&url) && is_web(&url) => {
                    open_external(&url);
                    WKNavigationActionPolicy::Cancel
                }
                _ => WKNavigationActionPolicy::Allow,
            };
            decision.call((policy,));
        }
    }

    unsafe impl WKScriptMessageHandler for Controller {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            let body = unsafe { message.body() };
            if let Ok(text) = body.downcast::<NSString>() {
                self.handle_message(&text.to_string());
            }
        }
    }

    impl Controller {
        #[unsafe(method(openInLocalix:))]
        fn open_in_localix(&self, _sender: Option<&AnyObject>) {
            let session = self.ivars().session.borrow().clone();
            match session {
                Some(id) => open_external(&format!("localix://session/{id}")),
                None => host::show_host(&self.ivars().config.host),
            }
        }

        #[unsafe(method(reloadPage:))]
        fn reload_page(&self, _sender: Option<&AnyObject>) {
            if let Some(web_view) = self.ivars().web_view.get() {
                unsafe { web_view.reload() };
            }
        }
    }
);

impl Controller {
    pub(crate) fn new(mtm: MainThreadMarker, config: Config) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(State {
            config,
            window: OnceCell::new(),
            web_view: OnceCell::new(),
            glass: OnceCell::new(),
            page_ui: OnceCell::new(),
            port: Cell::new(None),
            waiting_since: Cell::new(None),
            asked_host: Cell::new(false),
            gave_up: Cell::new(false),
            session: std::cell::RefCell::new(None),
        });
        unsafe { msg_send![super(this), init] }
    }

    /// Navigation inside the page's own origin stays in the app.
    fn owns(&self, url: &str) -> bool {
        match &self.ivars().config.ui {
            Ui::Directory(_) => url.starts_with(PAGE_ORIGIN),
            Ui::Url(base) => tauri::Url::parse(base)
                .ok()
                .zip(tauri::Url::parse(url).ok())
                .is_some_and(|(base, url)| base.origin() == url.origin()),
        }
    }

    fn handle_message(&self, text: &str) {
        let Ok(message) = serde_json::from_str::<serde_json::Value>(text) else {
            return;
        };
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        match message.get("type").and_then(|kind| kind.as_str()) {
            // The page's title row (`DRAG_SCRIPT`): move the window with the press, or zoom it.
            Some("drag") => {
                let app = NSApplication::sharedApplication(mtm);
                if let (Some(window), Some(event)) = (self.ivars().window.get(), app.currentEvent())
                {
                    window.performWindowDragWithEvent(&event);
                }
            }
            Some("zoom") => {
                if let Some(window) = self.ivars().window.get() {
                    window.performZoom(None);
                }
            }
            Some("badge") => {
                let label = message.get("text").and_then(|value| value.as_str());
                let label =
                    label.map(|text| NSString::from_str(&text.chars().take(8).collect::<String>()));
                NSApplication::sharedApplication(mtm)
                    .dockTile()
                    .setBadgeLabel(label.as_deref());
            }
            Some("theme") => {
                let Some(dark) = message.get("dark").and_then(|value| value.as_bool()) else {
                    return;
                };
                let (name, appearance) = if dark {
                    (unsafe { NSAppearanceNameDarkAqua }, Appearance::Dark)
                } else {
                    (unsafe { NSAppearanceNameAqua }, Appearance::Light)
                };
                let named = NSAppearance::appearanceNamed(name);
                NSApplication::sharedApplication(mtm).setAppearance(named.as_deref());
                if let Some(glass) = self.ivars().glass.get() {
                    crate::app_runner_glass::set_appearance(glass, appearance);
                }
            }
            Some("session") => {
                let id = message.get("id").and_then(|value| value.as_str());
                *self.ivars().session.borrow_mut() = id
                    .filter(|id| crate::companion_destination::valid_session_id(id))
                    .map(str::to_string);
            }
            _ => {}
        }
    }
}

fn absolute(url: &NSURL) -> Option<String> {
    url.absoluteString().map(|text| text.to_string())
}

/// The configuration every plugin app's web view starts from.
pub(crate) fn configuration(
    mtm: MainThreadMarker,
    controller: &Controller,
) -> Retained<WKWebViewConfiguration> {
    let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
    if let Ui::Directory(root) = &controller.ivars().config.ui {
        let scheme = crate::app_runner_scheme::Scheme::new(mtm, root.clone());
        unsafe {
            configuration.setURLSchemeHandler_forURLScheme(
                Some(ProtocolObject::from_ref(&*scheme)),
                &NSString::from_str(SCHEME),
            );
        }
    }
    unsafe {
        configuration
            .userContentController()
            .addScriptMessageHandler_name(
                ProtocolObject::from_ref(controller),
                &NSString::from_str(MESSAGE_HANDLER),
            );
    }
    configuration
}
