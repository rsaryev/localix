//! Serves the UI build that ships inside Localix.app to a standalone mini app's page, so the page
//! is always the version of the host that serves its data.
use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{ns_string, NSData, NSDictionary, NSHTTPURLResponse, NSString};
use objc2_web_kit::{WKURLSchemeHandler, WKURLSchemeTask, WKWebView};

use crate::app_runner_host as host;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = PathBuf]
    #[name = "LocalixMiniAppScheme"]
    pub(crate) struct Scheme;

    unsafe impl NSObjectProtocol for Scheme {}

    unsafe impl WKURLSchemeHandler for Scheme {
        #[unsafe(method(webView:startURLSchemeTask:))]
        fn start(&self, _web_view: &WKWebView, task: &ProtocolObject<dyn WKURLSchemeTask>) {
            serve(self.ivars(), task);
        }

        // Every response is complete before `start` returns, so there is nothing to stop.
        #[unsafe(method(webView:stopURLSchemeTask:))]
        fn stop(&self, _web_view: &WKWebView, _task: &ProtocolObject<dyn WKURLSchemeTask>) {}
    }
);

impl Scheme {
    pub(crate) fn new(mtm: MainThreadMarker, root: PathBuf) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(root);
        unsafe { msg_send![super(this), init] }
    }
}

fn serve(root: &Path, task: &ProtocolObject<dyn WKURLSchemeTask>) {
    let Some(url) = unsafe { task.request() }.URL() else {
        return;
    };
    let path = url.path().map(|path| path.to_string()).unwrap_or_default();
    let file = host::ui_file(root, &path);
    let body = file.as_deref().and_then(|file| std::fs::read(file).ok());
    let status = if body.is_some() { 200 } else { 404 };
    let mut keys = vec![ns_string!("Content-Type")];
    let mime = NSString::from_str(file.as_deref().map_or("text/plain", host::mime_type));
    let mut values = vec![mime];
    let csp = host::content_security_policy().map(|csp| NSString::from_str(&csp));
    if let (Some(csp), true) = (csp, path.ends_with(".html") || !path.contains('.')) {
        keys.push(ns_string!("Content-Security-Policy"));
        values.push(csp);
    }
    let values: Vec<&NSString> = values.iter().map(|value| &**value).collect();
    let headers = NSDictionary::from_slices(&keys, &values);
    let response = NSHTTPURLResponse::initWithURL_statusCode_HTTPVersion_headerFields(
        NSHTTPURLResponse::alloc(),
        &url,
        status,
        Some(ns_string!("HTTP/1.1")),
        Some(&headers),
    );
    let Some(response) = response else {
        return;
    };
    unsafe {
        task.didReceiveResponse(&response);
        task.didReceiveData(&NSData::with_bytes(body.as_deref().unwrap_or_default()));
        task.didFinish();
    }
}
