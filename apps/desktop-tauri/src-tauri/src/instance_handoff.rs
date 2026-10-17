//! The hand-off between a second launch and the shell that owns the data folder (`instance.rs`).
//!
//! The owner listens on `~/.localix/desktop-shell.sock`. A second launch collects what it was
//! asked to open — `localix://` links and Finder documents arrive as Apple events after launch,
//! argv paths at once — sends them there as one JSON line, brings the owner forward, and exits
//! without having started a runtime, built a window or touched the database.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::instance::Role;
use crate::log::logln;

const SOCKET: &str = "desktop-shell.sock";
/// A hand-off is a few URLs; anything larger is not one.
const MAX_MESSAGE: u64 = 64 * 1024;
/// How long a second launch keeps listening for the Apple events that carry its documents.
const COLLECT_WINDOW: Duration = Duration::from_millis(500);

#[derive(Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct Message {
    /// `localix://…` links and `file://…` document URLs, in arrival order.
    pub(crate) urls: Vec<String>,
    /// Command-line paths, relative to `cwd`.
    pub(crate) args: Vec<String>,
    pub(crate) cwd: String,
}

/// This launch's role, and — for a second launch — what it has collected so far.
pub(crate) struct Instance {
    pub(crate) role: Role,
    collected: Mutex<Vec<String>>,
}

impl Instance {
    pub(crate) fn new(role: Role) -> Self {
        Self {
            role,
            collected: Mutex::new(Vec::new()),
        }
    }
}

pub(crate) fn is_secondary(app: &AppHandle) -> bool {
    matches!(app.state::<Instance>().role, Role::Secondary { .. })
}

/// Keep a URL a second launch received, to forward with the rest.
pub(crate) fn collect(app: &AppHandle, url: String) {
    app.state::<Instance>().collected.lock().unwrap().push(url);
}

fn socket_path() -> PathBuf {
    crate::instance::data_dir().join(SOCKET)
}

/// Decide this launch's role (release builds only, like the runtime) and keep it in app state.
pub(crate) fn manage(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let role = if cfg!(debug_assertions) {
        Role::Primary
    } else {
        crate::instance::claim()
    };
    builder.manage(Instance::new(role))
}

/// Setup for a second launch: no runtime, no window, no Dock icon. It only collects what it was
/// asked to open and hands it over on `Ready`. Returns whether this launch is one; the owner
/// starts serving hand-offs instead.
pub(crate) fn setup_secondary(app: &mut tauri::App) -> bool {
    if !is_secondary(app.handle()) {
        serve(app.handle());
        return false;
    }
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event
            .urls()
            .into_iter()
            .filter(|url| url.scheme() == "localix")
        {
            collect(&handle, url.to_string());
        }
    });
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls.into_iter().filter(|url| url.scheme() == "localix") {
            collect(app.handle(), url.to_string());
        }
    }
    true
}

/// Run events a second launch handles itself. Returns true when the event is consumed.
pub(crate) fn on_run_event(app: &AppHandle, event: &tauri::RunEvent) -> bool {
    match event {
        tauri::RunEvent::Ready => {
            finish_secondary(app);
            false
        }
        tauri::RunEvent::Reopen { .. } => is_secondary(app),
        tauri::RunEvent::Opened { urls } if is_secondary(app) => {
            for url in urls {
                collect(app, url.to_string());
            }
            true
        }
        _ => false,
    }
}

/// Owner: accept hand-offs for the life of the process (release builds only).
fn serve(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let path = socket_path();
    // Only the lock holder gets here, so a socket file left behind is a dead owner's.
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            logln(format!(
                "instance: cannot listen for hand-offs at {path:?}: {error}"
            ));
            return;
        }
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut text = String::new();
            if stream.take(MAX_MESSAGE).read_to_string(&mut text).is_err() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Message>(text.trim()) else {
                logln("instance: ignored a malformed hand-off");
                continue;
            };
            logln(format!(
                "instance: hand-off from a second launch ({} url(s), {} arg(s))",
                message.urls.len(),
                message.args.len()
            ));
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || apply(&app, message));
        }
    });
}

/// Owner: do what the second launch was asked to do.
fn apply(app: &AppHandle, message: Message) {
    crate::deeplink::show_main_window(app);
    for raw in message.urls {
        let Ok(url) = tauri::Url::parse(&raw) else {
            continue;
        };
        if url.scheme() == "localix" {
            crate::deeplink::dispatch_deep_link(app, raw);
        } else if let Ok(path) = url.to_file_path() {
            crate::deeplink::dispatch_deep_link(app, crate::deeplink::open_path_deep_link(&path));
        }
    }
    if !message.args.is_empty() {
        crate::deeplink::open_path_args(app, &message.args, std::path::Path::new(&message.cwd));
    }
}

/// Second launch: once the Apple events of the launch have had time to arrive, forward them,
/// bring the owner forward, and leave. `process::exit`, not `app.exit`: there is no runtime to
/// stop, no page to flush and no window state worth saving.
fn finish_secondary(app: &AppHandle) {
    let Role::Secondary { owner } = app.state::<Instance>().role else {
        return;
    };
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(COLLECT_WINDOW);
        let message = Message {
            urls: std::mem::take(&mut *handle.state::<Instance>().collected.lock().unwrap()),
            args: std::env::args_os()
                .skip(1)
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect(),
            cwd: std::env::current_dir()
                .map(|dir| dir.to_string_lossy().into_owned())
                .unwrap_or_default(),
        };
        match send(&message) {
            Ok(()) => logln("instance: handed off to the running Localix"),
            Err(error) => logln(format!(
                "instance: the running Localix (pid {owner:?}) takes no hand-offs ({error}); \
                 focusing it only"
            )),
        }
        if let Some(pid) = owner {
            activate(pid);
        }
        crate::log::flush_startup_log();
        std::process::exit(0);
    });
}

/// Leave the data folder to another shell's runtime, which this shell's runtime refused to take
/// over (`OWNED_ELSEWHERE_PREFIX`): focus that shell and exit.
pub(crate) fn yield_to(shell_pid: u32) -> ! {
    logln(format!(
        "instance: another Localix (pid {shell_pid}) owns the data folder; handing over to it"
    ));
    activate(shell_pid);
    crate::log::flush_startup_log();
    std::process::exit(0);
}

fn send(message: &Message) -> std::io::Result<()> {
    let mut stream = UnixStream::connect(socket_path())?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(serde_json::to_string(message)?.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.shutdown(std::net::Shutdown::Write)
}

/// Bring the app with `pid` to the front. A just-launched app is the active one, so it may hand
/// activation to another (macOS 14 refuses an app in the background that tries to take it).
fn activate(pid: u32) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    let Some(class) = AnyClass::get(c"NSRunningApplication") else {
        return;
    };
    let Ok(pid) = i32::try_from(pid) else {
        return;
    };
    // NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps.
    const OPTIONS: usize = (1 << 0) | (1 << 1);
    unsafe {
        let running: *mut AnyObject =
            msg_send![class, runningApplicationWithProcessIdentifier: pid];
        if let Some(running) = running.as_ref() {
            let _: bool = msg_send![running, activateWithOptions: OPTIONS];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Message;

    #[test]
    fn a_hand_off_round_trips_as_one_json_line() {
        let message = Message {
            urls: vec![
                "localix://session/abc".into(),
                "file:///tmp/a%20b.md".into(),
            ],
            args: vec!["notes.md".into()],
            cwd: "/Users/someone".into(),
        };
        let line = serde_json::to_string(&message).unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(serde_json::from_str::<Message>(&line).unwrap(), message);
    }
}
