//! Where a plugin app finds Localix, and the pure pieces of serving its page.
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::app_runner::BACKGROUND_ARG;

/// A loopback connect either lands at once or there is no listener; never wait on it long.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(200);

/// The port of a runtime that is serving now. The descriptor
/// (`apps/api/src/lib/runtime-endpoint.ts`) outlives a runtime that crashed, so a port counts
/// only once something accepts on it.
pub(crate) fn live_port(endpoint_file: &Path) -> Option<u16> {
    let port = descriptor_port(&std::fs::read_to_string(endpoint_file).ok()?)?;
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), CONNECT_TIMEOUT).ok()?;
    Some(port)
}

/// The loopback port the descriptor's `baseUrl` names, read as the shell reads a ready frame.
fn descriptor_port(descriptor: &str) -> Option<u16> {
    let value: serde_json::Value = serde_json::from_str(descriptor).ok()?;
    crate::sidecar::runtime_port(value.get("baseUrl")?.as_str()?).ok()
}

/// Start the host without showing it; `open -g` leaves the app the person launched in front.
pub(crate) fn launch(host: &Path) -> std::io::Result<()> {
    let mut command = if is_bundle(host) {
        let mut open = Command::new("/usr/bin/open");
        open.arg("-g").arg("-a").arg(host).arg("--args");
        open
    } else {
        // A development host is the bare binary under `target/`, not a bundle.
        Command::new(host)
    };
    command
        .arg(BACKGROUND_ARG)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
}

/// Whether this host is running now, matched the way the Dock matches it: by its bundle on disk
/// (or, for a development binary, by its executable).
pub(crate) fn is_running(host: &Path) -> bool {
    use objc2_app_kit::NSWorkspace;
    let bundle = is_bundle(host);
    NSWorkspace::sharedWorkspace()
        .runningApplications()
        .iter()
        .any(|app| {
            let url = if bundle {
                app.bundleURL()
            } else {
                app.executableURL()
            };
            url.and_then(|url| url.path())
                .is_some_and(|path| Path::new(&path.to_string()) == host)
        })
}

fn is_bundle(host: &Path) -> bool {
    host.extension().is_some_and(|extension| extension == "app")
}

/// Bring Localix itself forward; its reopen ends a background launch's hold.
pub(crate) fn show_host(host: &Path) {
    let mut command = if is_bundle(host) {
        let mut open = Command::new("/usr/bin/open");
        open.arg("-a").arg(host);
        open
    } else {
        Command::new(host)
    };
    let _ = command.stdin(Stdio::null()).spawn();
}

/// What the page reads before any of its code runs: the plugin it hosts, the app's project folder
/// and the runtime's port.
pub(crate) fn page_globals(plugin: &str, name: &str, project: &Path, port: u16) -> String {
    let app = serde_json::json!({ "plugin": plugin, "name": name, "projectDir": project });
    format!(
        "window.__LOCALIX_APP={app};window.__LOCALIX_API_PORT={port};window.__LOCALIX_OAUTH_PORT={port};"
    )
}

/// Tauri's title-row contract, for a page with no Tauri: a press on an element that itself carries
/// `data-tauri-drag-region` moves the window, and a double press zooms it (`chrome.css`).
pub(crate) const DRAG_SCRIPT: &str = "document.addEventListener('mousedown',(e)=>{if(e.button!==0||!(e.target instanceof Element)||!e.target.hasAttribute('data-tauri-drag-region'))return;e.preventDefault();window.webkit.messageHandlers.localixApp.postMessage(JSON.stringify({type:e.detail===2?'zoom':'drag'}))},true);";

/// The file a `localix-app://app/<path>` request names inside the UI build. A path that climbs out
/// of it is refused; a route without an extension is the single-page app's own `index.html`.
pub(crate) fn ui_file(root: &Path, url_path: &str) -> Option<PathBuf> {
    let relative = url_path.trim_start_matches('/');
    if relative.is_empty() {
        return Some(root.join("index.html"));
    }
    let mut file = root.to_path_buf();
    for part in relative.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return None;
        }
        file.push(part);
    }
    if file.extension().is_none() && !file.is_file() {
        return Some(root.join("index.html"));
    }
    Some(file)
}

pub(crate) fn mime_type(file: &Path) -> &'static str {
    let extension = file.extension().and_then(|extension| extension.to_str());
    match extension.unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The shell's own Content-Security-Policy (`tauri.conf.json`), so a plugin app's page runs under
/// the same rules as the workspace that serves it through Tauri.
pub(crate) fn content_security_policy() -> Option<String> {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).ok()?;
    Some(config.pointer("/app/security/csp")?.as_str()?.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_descriptor_names_only_a_loopback_http_port() {
        let at = |base: &str| descriptor_port(&format!(r#"{{"pid":1,"baseUrl":"{base}"}}"#));
        assert_eq!(at("http://127.0.0.1:62075"), Some(62075));
        assert_eq!(at("http://localhost:5051/"), Some(5051));
        assert_eq!(at("http://192.168.1.4:5051"), None);
        assert_eq!(at("https://127.0.0.1:5051"), None);
        assert_eq!(descriptor_port("not json"), None);
        assert_eq!(descriptor_port(r#"{"pid":1}"#), None);
    }

    #[test]
    fn a_page_request_stays_inside_the_ui_build() {
        let root = std::env::temp_dir().join(format!("localix-app-ui-{}", std::process::id()));
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join("assets/app.js"), "").unwrap();
        assert_eq!(ui_file(&root, "/"), Some(root.join("index.html")));
        assert_eq!(
            ui_file(&root, "/assets/app.js"),
            Some(root.join("assets/app.js"))
        );
        assert_eq!(
            ui_file(&root, "/project/abc"),
            Some(root.join("index.html"))
        );
        assert_eq!(
            ui_file(&root, "/assets/missing.js"),
            Some(root.join("assets/missing.js"))
        );
        assert_eq!(ui_file(&root, "/../secret"), None);
        assert_eq!(ui_file(&root, "/assets/../../secret"), None);
        assert_eq!(ui_file(&root, "/assets//app.js"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn page_globals_are_json_not_interpolated_text() {
        let script = page_globals(
            "task-notes",
            "Board \"Q3\"</script>",
            Path::new("/h/.localix/apps/task-notes"),
            4321,
        );
        assert!(script.contains(r#""plugin":"task-notes""#));
        assert!(script.contains(r#""projectDir":"/h/.localix/apps/task-notes""#));
        assert!(script.contains(r#"Board \"Q3\"</script>"#));
        assert!(script.contains("window.__LOCALIX_API_PORT=4321;"));
    }

    #[test]
    fn modules_and_styles_get_types_webkit_will_execute() {
        assert_eq!(
            mime_type(Path::new("a/index-1.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_type(Path::new("a/A.CSS")), "text/css; charset=utf-8");
        assert_eq!(mime_type(Path::new("a/blob")), "application/octet-stream");
    }

    #[test]
    fn the_policy_comes_from_the_shell_config() {
        let csp = content_security_policy().expect("tauri.conf.json declares a CSP");
        assert!(csp.contains("default-src 'self'"));
    }
}
