//! A plugin app's page: loading it against the runtime, the scripts every load runs first, and
//! the short notices shown while there is no page to load.
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSString, NSURLRequest, NSURL};
use objc2_web_kit::{WKUserScript, WKUserScriptInjectionTime};

use crate::app_runner::{Ui, PAGE_ORIGIN};
use crate::app_runner_host as host;
use crate::app_runner_web::Controller;

impl Controller {
    /// Load the plugin's page against the runtime on `port`, replacing whatever is shown.
    pub(crate) fn load_page(&self, mtm: MainThreadMarker, port: u16) {
        let Some(web_view) = self.ivars().web_view.get() else {
            return;
        };
        self.set_page_scripts(mtm, port);
        let config = &self.ivars().config;
        let address = match &config.ui {
            Ui::Directory(_) => format!("{PAGE_ORIGIN}/index.html"),
            Ui::Url(base) => base.clone(),
        };
        if let Some(url) = NSURL::URLWithString(&NSString::from_str(&address)) {
            unsafe { web_view.loadRequest(&NSURLRequest::requestWithURL(&url)) };
        }
    }

    /// What every load of the page runs before it paints: who it is, where its runtime is, how
    /// its title row sits beside the window buttons (the workspace's own measurement) and how that
    /// row moves the window. Set again when the measurement changes, so a reload never brings back
    /// the old one.
    fn set_page_scripts(&self, mtm: MainThreadMarker, port: u16) {
        let (Some(web_view), Some(window)) =
            (self.ivars().web_view.get(), self.ivars().window.get())
        else {
            return;
        };
        let config = &self.ivars().config;
        let globals = host::page_globals(&config.plugin, &config.name, &config.project, port);
        let title_row = crate::native_chrome::measure(window)
            .map(crate::native_chrome::apply_script)
            .unwrap_or_default();
        let content = unsafe { web_view.configuration().userContentController() };
        unsafe { content.removeAllUserScripts() };
        for source in [globals.as_str(), title_row.as_str(), host::DRAG_SCRIPT] {
            let script = unsafe {
                WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                    WKUserScript::alloc(mtm),
                    &NSString::from_str(source),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    true,
                )
            };
            unsafe { content.addUserScript(&script) };
        }
    }

    /// Fullscreen hides the window buttons and changes the row: re-measure for the page on screen
    /// and for the next load.
    pub(crate) fn lay_out_title_row(&self) {
        let (Some(mtm), Some(port)) = (MainThreadMarker::new(), self.ivars().port.get()) else {
            return;
        };
        self.set_page_scripts(mtm, port);
        let (Some(web_view), Some(window)) =
            (self.ivars().web_view.get(), self.ivars().window.get())
        else {
            return;
        };
        if let Some(geometry) = crate::native_chrome::measure(window) {
            let script = NSString::from_str(&crate::native_chrome::apply_script(geometry));
            unsafe { web_view.evaluateJavaScript_completionHandler(&script, None) };
        }
    }

    /// A short native-styled notice while Localix starts, or when it cannot.
    pub(crate) fn show_notice(&self, text: &str) {
        let Some(web_view) = self.ivars().web_view.get() else {
            return;
        };
        let text = text.replace('&', "&amp;").replace('<', "&lt;");
        let html = format!(
            "<!doctype html><meta name=color-scheme content='light dark'><body style=\"margin:0;\
             height:100vh;display:grid;place-items:center;font:13px -apple-system,system-ui;\
             color:GrayText;background:transparent\">{text}</body>"
        );
        unsafe { web_view.loadHTMLString_baseURL(&NSString::from_str(&html), None) };
    }
}
