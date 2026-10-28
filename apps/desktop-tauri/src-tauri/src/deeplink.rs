//! Deep links (`localix://…`), the navigation policy, and window reveal.
//!
//! Owns three pieces of knowledge the rest of the shell should not have to hold:
//!
//!   1. WHICH URLs are the app itself (`is_internal_url`) vs. a local loopback
//!      server (`is_loopback`) vs. the open internet. This is a navigation
//!      ALLOWLIST — everything else is handed to the system browser — so it is
//!      security-relevant and lives in exactly one place.
//!   2. The cold-start BUFFERING protocol: the OS can launch the app to service a
//!      URL long before the webview has a handler, so links queue until the UI
//!      signals readiness, then flush in arrival order.
//!   3. How a URL/menu id is handed to the UI at all (a JSON-encoded `eval` of
//!      `window.__localix*`, so a value can never break out of the string literal).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::log::{flush_startup_log, logln};
use crate::tray::setup_tray_after_ready;

/// Buffers deep-link URLs that arrive BEFORE the webview's handler is installed
/// (cold launch: the OS starts the app to service a `localix://` URL). Once the
/// UI signals readiness via the `deep_link_ready` command, buffered URLs flush in
/// arrival order; after that, links dispatch straight through.
#[derive(Default)]
pub(crate) struct DeepLinks {
    pub(crate) ready: AtomicBool,
    pending: Mutex<Vec<String>>,
}

impl DeepLinks {
    fn dispatch(&self, url: String, eval: impl FnOnce(&str)) {
        // The ready check and enqueue share the flush lock. A producer cannot
        // enqueue after the ready handshake has already drained the cold queue.
        let mut pending = self.pending.lock().unwrap();
        if self.ready.load(Ordering::Acquire) {
            eval(&url);
        } else {
            pending.push(url);
        }
    }

    fn flush(&self, eval: impl Fn(&str)) {
        let mut pending = self.pending.lock().unwrap();
        self.ready.store(true, Ordering::Release);
        for url in std::mem::take(&mut *pending) {
            eval(&url);
        }
    }
}

/// Whether a navigation target is the app itself (so it may load in-webview) vs.
/// an external site (which must open in the system browser instead of replacing
/// the app). Prod serves from `tauri://localhost` (macOS/Linux) or
/// `http://tauri.localhost` (Windows); dev serves from the Vite dev server on
/// localhost — treated as internal only in debug builds.
pub(crate) fn is_internal_url(url: &tauri::Url) -> bool {
    if url.scheme() == "tauri" {
        return url.host_str() == Some("localhost");
    }
    // NOT a `matches!`: the loopback arm is `cfg!(debug_assertions)`, so localhost is
    // internal only in debug builds. Clippy analyzes in debug (where that folds to
    // `true`) and mis-flags this — collapsing to `matches!` would wrongly treat
    // localhost as internal in release too.
    #[allow(clippy::match_like_matches_macro)]
    match url.host_str() {
        Some("tauri.localhost") => true,
        Some("localhost") | Some("127.0.0.1") => cfg!(debug_assertions),
        _ => false,
    }
}

/// A URL that should leave the webview through the user's OS handler.
pub(crate) fn is_external_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "mailto" | "tel" => !url.path().is_empty(),
        _ => false,
    }
}

/// Schemes WebKit itself needs for generated documents/workers. Everything
/// else that is neither app-owned, loopback, nor external is denied.
pub(crate) fn is_embedded_navigation_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "about" | "blob" | "data")
}

/// Whether a navigation target is a local loopback server (dev server, the
/// embedded API's preview strip-proxy, a user's app under development). The
/// webview's `on_navigation` handler fires for EVERY frame — including the
/// Preview pane's iframe — so loopback http(s) must stay allowed in RELEASE
/// builds too, or the preview iframe gets cancelled and the system browser
/// pops instead. Any port; http/https only (ws upgrades never hit on_navigation).
pub(crate) fn is_loopback(url: &tauri::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    // url's host_str() keeps the brackets on IPv6, so "[::1]" matches verbatim.
    matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("[::1]")
    )
}

/// Reveal + focus the main window (from tray click, menu, or a second launch).
pub(crate) fn show_main_window(app: &AppHandle) {
    if crate::workspace_lifecycle::release_hold(app) {
        return;
    }
    #[cfg(target_os = "macos")]
    crate::workspace_visibility::reopen(app);
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = crate::workspace_windows::active_view(app) {
        let _ = w.window().unminimize();
        let _ = w.window().show();
        let _ = w.window().set_focus();
    }
}

/// Forward one raw `localix://…` URL into the webview by calling the UI's
/// `window.__localixDeepLink(url)` handler, or buffer it if the UI isn't ready.
pub(crate) fn dispatch_deep_link<R: tauri::Runtime>(app: &AppHandle<R>, url: String) {
    let state = app.state::<DeepLinks>();
    let ready = state.ready.load(Ordering::Acquire);
    // Breadcrumb (temp log): confirms a localix:// URL reached the app and whether it
    // ran now or buffered for the UI to flush — the first thing to check if a
    // `localix <path>` / file-association open seems to do nothing.
    logln(format!(
        "deep-link {} url={url}",
        if ready { "eval" } else { "buffer" }
    ));
    state.dispatch(url, |url| eval_deep_link(app, url));
}

/// Build the `localix://open?path=<abs>` deep link for a filesystem path (percent-
/// encoded through the URL query). Backs FILE ASSOCIATIONS — double-clicking an
/// associated file opens it in the running app via the exact same open flow the
/// `localix <path>` CLI uses (a file → a lightweight editor tab).
pub(crate) fn open_path_deep_link(path: &std::path::Path) -> String {
    let mut url = tauri::Url::parse("localix://open").expect("static base parses");
    url.query_pairs_mut()
        .append_pair("path", &path.to_string_lossy());
    url.to_string()
}

/// Surface the window and open each existing file/dir among `args` (file-association
/// or CLI launch on Windows + Linux, where the path arrives as a process argument;
/// macOS instead delivers it via `RunEvent::Opened`). Skips flags and `localix://`
/// URLs — the deep-link plugin owns those.
///
/// `cwd` is the directory of the launch that PASSED the arguments. A second launch
/// hands its argv to the running instance, and resolving `localix src/app.ts`
/// against the running instance's own directory opened the wrong file, or nothing.
pub(crate) fn open_path_args<S: AsRef<std::ffi::OsStr>>(
    app: &AppHandle,
    args: &[S],
    cwd: &std::path::Path,
) {
    for arg in args {
        let Some(path) = open_arg_path(arg.as_ref(), cwd) else {
            continue;
        };
        if path.is_file() || path.is_dir() {
            show_main_window(app);
            dispatch_deep_link(app, open_path_deep_link(&path));
        }
    }
}

/// The filesystem path one launch argument names, resolved against the launching
/// directory, or `None` for a flag or a `localix://` URL.
fn open_arg_path(arg: &std::ffi::OsStr, cwd: &std::path::Path) -> Option<std::path::PathBuf> {
    let text = arg.to_string_lossy();
    if text.starts_with('-') || text.starts_with("localix://") {
        return None;
    }
    // Linux desktop launchers may pass a URI (%U), rather than a plain path (%F).
    if text.starts_with("file:") {
        return tauri::Url::parse(&text).ok()?.to_file_path().ok();
    }
    // `join` keeps an absolute argument as it is.
    Some(cwd.join(arg))
}

/// Evaluate the UI handler for a single URL. The URL is JSON-encoded so it can
/// never break out of the string literal (injection-safe).
fn eval_deep_link<R: tauri::Runtime>(app: &AppHandle<R>, url: &str) {
    if let Some(w) = crate::workspace_windows::active_view(app) {
        let arg = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into());
        let _ = w.eval(format!(
            "window.__localixDeepLink && window.__localixDeepLink({arg})"
        ));
    }
}

/// Forward a native-menu command id into the webview by calling the UI's
/// `window.__localixMenu(id)` handler (installed by useNativeMenu). This is the
/// bridge for menu items that map to in-app actions with no deep-link route —
/// Open File, Save, Toggle Sidebar, the panel openers, etc. The id is JSON-encoded
/// so it can never break out of the string literal (injection-safe). No-op if the
/// UI hasn't installed the handler yet.
pub(crate) fn forward_menu_command(app: &AppHandle, id: &str) {
    if let Some(w) = crate::workspace_windows::active_view(app) {
        show_main_window(app);
        let arg = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into());
        let _ = w.eval(format!(
            "window.__localixMenu && window.__localixMenu({arg})"
        ));
    }
}

/// Native edit selectors bypass Monaco's command stack. Dispatch only in the
/// webview with document focus, without `show_main_window` stealing a child
/// browser's focus. Other pages keep the DOM command they previously received.
pub(crate) fn forward_edit_command<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) -> bool {
    let dom_command = match id {
        "undo" => "undo",
        "redo" => "redo",
        "select_all" => "selectAll",
        _ => return false,
    };
    let command = serde_json::to_string(id).expect("edit command serializes");
    let dom_command = serde_json::to_string(dom_command).expect("DOM command serializes");
    let script = format!(
        "if (document.hasFocus()) {{ if (window.__localixEdit) {{ window.__localixEdit({command}); }} else {{ document.execCommand({dom_command}); }} }}"
    );
    for view in app.webviews().values() {
        let _ = view.eval(script.clone());
    }
    true
}

/// Called by the UI once its deep-link handler is installed: mark ready and flush
/// any buffered cold-start URLs in arrival order. Also the window-reveal
/// handshake: the window is built hidden (no white flash on a dark-theme macOS
/// launch — background_color doesn't cover the WKWebView layer), and this command
/// fires from a UI useLayoutEffect right after first commit, so showing here lands at
/// first paint with the correct theme already applied.
#[tauri::command]
pub(crate) fn deep_link_ready(app: AppHandle, caller: tauri::Webview) {
    if crate::workspace_windows::require_workspace(&caller).is_err() {
        return;
    }
    crate::workspace_windows::reveal(&app, caller.label());
    let state = app.state::<DeepLinks>();
    state.flush(|url| {
        let arg = serde_json::to_string(url).expect("deep link serializes");
        let _ = caller.eval(format!(
            "window.__localixDeepLink && window.__localixDeepLink({arg})"
        ));
    });
    flush_startup_log();
    setup_tray_after_ready(&app);
}

#[cfg(test)]
mod tests {
    use super::{
        is_embedded_navigation_url, is_external_url, is_internal_url, is_loopback, open_arg_path,
    };
    use super::{open_path_deep_link, DeepLinks};
    use std::ffi::OsStr;

    fn url(value: &str) -> tauri::Url {
        tauri::Url::parse(value).expect("test URL parses")
    }

    #[test]
    fn a_launch_argument_resolves_against_the_launching_directory() {
        let launched_in = std::env::temp_dir().join("second-launch");
        assert_eq!(
            open_arg_path(OsStr::new("src/app.ts"), &launched_in),
            Some(launched_in.join("src/app.ts"))
        );
        let absolute = std::env::temp_dir().join("notes.md");
        assert_eq!(
            open_arg_path(absolute.as_os_str(), &launched_in),
            Some(absolute.clone())
        );
        assert_eq!(open_arg_path(OsStr::new("--new"), &launched_in), None);
        assert_eq!(
            open_arg_path(OsStr::new("localix://session/1"), &launched_in),
            None
        );
    }

    #[test]
    fn file_uri_arguments_and_deep_links_preserve_special_characters() {
        let path = std::env::temp_dir().join("données #100% + sample.json");
        let file_url = tauri::Url::from_file_path(&path).expect("absolute file path");
        assert_eq!(
            open_arg_path(OsStr::new(file_url.as_str()), &std::env::temp_dir()),
            Some(path.clone())
        );
        let link = url(&open_path_deep_link(&path));
        assert_eq!(link.scheme(), "localix");
        assert_eq!(link.host_str(), Some("open"));
        assert_eq!(
            link.query_pairs().find(|(key, _)| key == "path").unwrap().1,
            path.to_string_lossy()
        );
        assert_eq!(
            open_arg_path(
                OsStr::new("file://remote-host/file.json"),
                &std::env::temp_dir()
            ),
            None
        );
    }

    #[test]
    fn cold_links_flush_once_in_order_then_warm_links_dispatch() {
        let links = DeepLinks::default();
        let received = std::sync::Mutex::new(Vec::new());
        let eval = |url: &str| received.lock().unwrap().push(url.to_owned());
        links.dispatch("first".into(), eval);
        links.dispatch("second".into(), eval);
        assert!(received.lock().unwrap().is_empty());
        links.flush(eval);
        links.dispatch("third".into(), eval);
        links.flush(eval);
        assert_eq!(*received.lock().unwrap(), vec!["first", "second", "third"]);
    }

    #[test]
    fn an_open_racing_the_ready_handshake_is_never_stranded() {
        let links = std::sync::Arc::new(DeepLinks::default());
        let received = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        std::thread::scope(|scope| {
            let producer = links.clone();
            let output = received.clone();
            scope.spawn(move || {
                for index in 0..100 {
                    producer.dispatch(index.to_string(), |url| {
                        output.lock().unwrap().push(url.to_owned())
                    });
                }
            });
            links.flush(|url| received.lock().unwrap().push(url.to_owned()));
        });
        assert_eq!(received.lock().unwrap().len(), 100);
        assert!(links.pending.lock().unwrap().is_empty());
    }

    /// A file name that is not valid Unicode is still a file to open, not a crash.
    #[cfg(unix)]
    #[test]
    fn a_non_unicode_argument_is_a_path_not_a_panic() {
        use std::os::unix::ffi::OsStrExt;
        let name = OsStr::from_bytes(b"caf\xe9.txt");
        let cwd = std::path::Path::new("/tmp");
        assert_eq!(open_arg_path(name, cwd), Some(cwd.join(name)));
    }

    #[test]
    fn navigation_policy_has_explicit_scheme_and_host_boundaries() {
        assert!(is_internal_url(&url("tauri://localhost/index.html")));
        assert!(!is_internal_url(&url("tauri://untrusted/index.html")));

        assert!(is_loopback(&url("http://127.0.0.1:5050/preview")));
        assert!(!is_loopback(&url("file:///tmp/preview.html")));

        assert!(is_external_url(&url("https://localix.dev")));
        assert!(is_external_url(&url("mailto:hello@localix.dev")));
        assert!(is_external_url(&url("tel:+35799123456")));
        assert!(!is_external_url(&url("javascript:alert(1)")));

        assert!(is_embedded_navigation_url(&url("about:blank")));
        assert!(is_embedded_navigation_url(&url("data:text/plain,hello")));
        assert!(!is_embedded_navigation_url(&url("file:///etc/passwd")));
    }
}
