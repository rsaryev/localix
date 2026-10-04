//! Managed production API sidecar.
//!
//! Desktop starts Bun directly and never waits for it in Tauri's `setup` hook.
//! The webview paints its startup surface immediately and retries the local API;
//! readiness/failure is mirrored into a small browser global for useful errors.

use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use crate::log::logln;
use crate::process_tree::ProcessTree;

const READY_PREFIX: &str = "LOCALIX_RUNTIME_READY ";

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeReady {
    base_url: String,
    pid: u32,
}

/// The last runtime status handed to the webview.
///
/// Recorded because `eval` is fire-and-forget: a script evaluated before the
/// document exists is simply lost, and on a warm start the sidecar can be
/// listening BEFORE the webview finishes loading `index.html`. Without a record
/// the page would sit on the `starting` value its initialization script wrote,
/// with no way to ever learn otherwise. The `resync_runtime_status` command
/// replays this snapshot on demand.
struct RuntimeStatusSnapshot {
    status: String,
    detail: Option<String>,
    port: Option<u16>,
}

impl Default for RuntimeStatusSnapshot {
    fn default() -> Self {
        Self {
            status: "starting".into(),
            detail: None,
            port: None,
        }
    }
}

/// The running API child and the process tree it heads. Kept as one record so no path can drop
/// the child and keep its tree, or the reverse: dropping the record is what ends the tree.
struct ManagedChild {
    child: CommandChild,
    _tree: ProcessTree,
}

#[derive(Default)]
pub(crate) struct ApiSidecar {
    child: Mutex<Option<ManagedChild>>,
    stopping: AtomicBool,
    /// Set while an update is being installed: a runtime that dies then must stay dead, since the
    /// files a respawn would load are the ones being replaced.
    respawn_held: AtomicBool,
    /// How many times a runtime that died after `ready` has been started again.
    respawns: AtomicU32,
    status: Mutex<RuntimeStatusSnapshot>,
    /// The most recent line the runtime wrote that was not the readiness frame.
    ///
    /// A start that fails does so with a reason, and that reason is on stdout/stderr —
    /// but the only thing the user ever saw was the shell's own "timed out", which names
    /// the symptom and nothing else. Keeping the last line means the timeout can quote
    /// what the runtime was actually saying when the deadline hit.
    last_line: Mutex<Option<String>>,
}

/// Windows `resource_dir()` returns a verbatim path (`\\?\C:\…`). Bun can't
/// dynamically import modules below that prefix, so hand it a plain path.
fn clean_path(p: &std::path::Path) -> String {
    plain_windows_path(&p.to_string_lossy())
}

/// The non-verbatim spelling of a verbatim Windows path.
///
/// Stripping the four-character `\\?\` prefix is right only for a DRIVE path. An install on a
/// network share resolves to `\\?\UNC\server\share\…`, where the same strip produced
/// `UNC\server\share\…` — a RELATIVE path naming a folder called `UNC`, so the runtime could not
/// even be found. The verbatim UNC form maps to `\\server\share\…` instead. Any other verbatim
/// kind (`\\?\Volume{…}`, `\\?\GLOBALROOT…`) has no plain spelling and is passed through untouched.
/// A string function rather than `std::path::Prefix`, so the rule is tested on every host and not
/// only on the Windows machines CI never runs Rust tests on.
fn plain_windows_path(path: &str) -> String {
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return rest.to_string();
        }
    }
    path.to_string()
}

fn reserve_loopback_port() -> std::io::Result<u16> {
    let socket = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(socket.local_addr()?.port())
}

fn runtime_port(base_url: &str) -> Result<u16, Box<dyn std::error::Error>> {
    let authority = base_url
        .strip_prefix("http://")
        .ok_or("runtime endpoint is not HTTP loopback")?;
    let (_, port) = authority
        .rsplit_once(':')
        .ok_or("runtime endpoint has no port")?;
    Ok(port.parse()?)
}

/// The status handoff script.
///
/// IDEMPOTENT by construction, because it is replayed: the page decides whether it
/// is already addressing the attested port and reloads only when it is not. The
/// reload used to be a second, unconditional `eval` on the Rust side, which cannot
/// be replayed — a resync would have reloaded a page that was already correct, and
/// every reload would have asked for another one.
fn status_script(status: &str, detail: Option<&str>, port: Option<u16>) -> String {
    let status = serde_json::to_string(status).unwrap_or_else(|_| "\"error\"".into());
    let detail = serde_json::to_string(&detail).unwrap_or_else(|_| "null".into());
    let event_detail = format!(r#"{{"status":{status},"error":{detail}}}"#);
    let port_script = port.map_or_else(String::new, |port| {
        format!(
            "if(window.__LOCALIX_API_PORT!=={port}){{sessionStorage.setItem('__localix_api_port','{port}');window.__LOCALIX_API_PORT={port};window.__LOCALIX_OAUTH_PORT={port};window.location.reload();return;}}"
        )
    });
    format!(
        "(function(){{{port_script}window.__LOCALIX_RUNTIME_STATUS={status};window.__LOCALIX_RUNTIME_ERROR={detail};window.dispatchEvent(new CustomEvent('localix-runtime-status',{{detail:{event_detail}}}));}})();"
    )
}

/// Record the runtime status and hand it to the webview. Recording is what makes
/// the delivery recoverable — see [`RuntimeStatusSnapshot`].
fn publish_status(app: &tauri::AppHandle, status: &str, detail: Option<&str>, port: Option<u16>) {
    if let Ok(mut snapshot) = app.state::<ApiSidecar>().status.lock() {
        snapshot.status = status.to_string();
        snapshot.detail = detail.map(str::to_string);
        // A later error carries no port; keep the attested one so a resync still
        // addresses the right origin.
        if port.is_some() {
            snapshot.port = port;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(status_script(status, detail, port));
    }
}

/// Replay the recorded runtime status into the webview.
///
/// The UI calls this once when its own state still reads `starting`: on a warm
/// start the sidecar can become ready before the document exists, and that `eval`
/// is lost with no way for the page to notice. Cross-platform by construction —
/// nothing here is OS-specific; the race is a webview-lifecycle one.
#[tauri::command]
pub(crate) fn resync_runtime_status(app: tauri::AppHandle) {
    let (status, detail, port) = {
        let state = app.state::<ApiSidecar>();
        let Ok(snapshot) = state.status.lock() else {
            return;
        };
        (
            snapshot.status.clone(),
            snapshot.detail.clone(),
            snapshot.port,
        )
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(status_script(&status, detail.as_deref(), port));
    }
}

/// The timeout, quoting whatever the runtime last said.
///
/// "timed out waiting for the local API" on its own is unactionable: it names the
/// symptom and withholds every fact the runtime had already written down. The runtime
/// now narrates its pre-boot decisions to stderr, so the last of those lines is usually
/// the entire diagnosis ("ownership held by pid N, which is not serving"). A start that
/// genuinely said nothing still gets the bare message plus where to look.
fn timeout_message(app: &tauri::AppHandle) -> String {
    let last = app
        .state::<ApiSidecar>()
        .last_line
        .lock()
        .ok()
        .and_then(|line| line.clone());
    format_timeout_message(last.as_deref())
}

/// What the runtime prints the moment its code runs (`apps/api/src/index.ts`).
const CODE_LOADED_PREFIX: &str = "[startup] runtime code loaded";

fn format_timeout_message(last: Option<&str>) -> String {
    match last {
        // Loaded and then went quiet: nothing past that line says why, so point at the log.
        Some(line) if line.starts_with(CODE_LOADED_PREFIX) => {
            "timed out waiting for the local API: it started but never became ready \
             (see ~/.localix/logs/api.log)"
                .to_string()
        }
        Some(line) => format!("timed out waiting for the local API — last: {line}"),
        // Not even the first line: the process never got to run its own code. The one cause
        // seen live is macOS holding the read of the app's files behind a folder-access prompt
        // (an app run from Documents, Desktop or Downloads).
        None => "the local API could not start: it never got to run its code. If macOS asked \
                 to allow access to a folder, allow it and restart Localix; otherwise see \
                 ~/.localix/logs/api.log"
            .to_string(),
    }
}

fn report_error(app: &tauri::AppHandle, message: impl Into<String>) {
    let message = message.into();
    logln(format!("API startup failed: {message}"));
    publish_status(app, "error", Some(&message), None);
}

/// How long a LOCAL process gets to bind its port before it is treated as stuck.
///
/// Measured on this machine, a healthy start is 0.6s warm and 4.5s on a cold page
/// cache. The old budget was 45 seconds, which is not patience — it is the whole
/// user-visible failure: three quarters of a minute of nothing, then a kill and a
/// dead app. See [`READY_ATTEMPTS`] for what replaced the giving-up half.
///
/// Now also the OUTER half of a two-level deadline: the runtime bounds its own startup
/// waits well below this (see `ATTACH_WAIT_MS` and the shutdown deadline in
/// `apps/api/src/index.ts`), so by the time this fires the runtime has already failed
/// and said why. Twenty seconds meant the reverse — the runtime's own 40s wait could
/// never complete, so it was killed mid-wait and the reason never existed.
const READY_TIMEOUT_SECS: u64 = 12;

/// A stuck first start is retried ONCE before it becomes an error.
///
/// Observed live: a runtime hung with no log output at all and was killed at the
/// deadline, and the very next start of the same binary was ready in 580ms. That
/// is the shape of a transient — a lease, a WAL recovery, a port — and the shell
/// was turning it into a permanently broken launch that only a manual restart
/// could clear. A second attempt is what the user would have done by hand.
const READY_ATTEMPTS: u32 = 2;

/// Reserve the production API port and return the preload script plus the launch
/// inputs. A failure is reported to the already-painted UI, never returned
/// through `setup()` (a release panic there previously became SIGABRT).
pub(crate) fn prepare_api(app: &tauri::App) -> (String, Option<(std::path::PathBuf, u16)>) {
    if cfg!(debug_assertions) {
        return (String::new(), None);
    }

    let port = match reserve_loopback_port() {
        Ok(port) => port,
        Err(error) => {
            let message = format!("cannot reserve a local API port: {error}");
            report_error(app.handle(), message.clone());
            return (init_error_script(&message), None);
        }
    };
    let init = init_script(Some(port));
    let res = match app.path().resource_dir() {
        Ok(path) => path.join("resources"),
        Err(error) => {
            let message = format!("cannot resolve app resources: {error}");
            report_error(app.handle(), message.clone());
            return (init_error_script(&message), None);
        }
    };
    (init, Some((res, port)))
}

/// Spawn the prepared runtime after the webview has begun loading. Readiness and
/// failures keep flowing through the existing asynchronous status handshake.
pub(crate) fn start_api(app: &tauri::AppHandle, launch: Option<(std::path::PathBuf, u16)>) {
    if let Some((res, port)) = launch {
        let _ = spawn_runtime(app, &res, port, 1);
    }
}

/// Spawn one runtime attempt and supervise it. Reported failures go to the painted
/// UI; the returned `Err` exists only for the very first attempt, whose message
/// also has to reach the page through its initialization script.
fn spawn_runtime(
    app: &tauri::AppHandle,
    res: &std::path::Path,
    port: u16,
    attempt: u32,
) -> Result<(), String> {
    let server = res.join("server.js");
    logln(format!(
        "resource_dir={:?} server_exists={} reserved_port={port} attempt={attempt}/{READY_ATTEMPTS}",
        res,
        server.exists()
    ));

    use tauri_plugin_shell::ShellExt;
    let command = match app.shell().sidecar("bun") {
        Ok(command) => command,
        Err(error) => {
            let message = format!("cannot resolve bundled Bun: {error}");
            report_error(app, message.clone());
            return Err(message);
        }
    };
    let spawned = command
        .arg(clean_path(&server))
        .arg("--desktop-runtime")
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("LOCALIX_DESKTOP_PARENT_PID", std::process::id().to_string())
        // The API stamps every line with it, so one launch reads as one timeline (log.rs).
        .env("LOCALIX_LAUNCH_ID", crate::log::launch_id())
        .env(
            "LOCALIX_CLI_ENTRY",
            clean_path(&res.join("cli").join("bin").join("localix.mjs")),
        )
        .spawn();

    let (mut events, child) = match spawned {
        Ok(pair) => pair,
        Err(error) => {
            let message = format!("cannot spawn bundled API: {error}");
            report_error(app, message.clone());
            return Err(message);
        }
    };
    let child_pid = child.pid();
    logln(format!("managed API child spawned pid={child_pid}"));
    *app.state::<ApiSidecar>().child.lock().unwrap() = Some(ManagedChild {
        child,
        _tree: ProcessTree::adopt(child_pid),
    });

    let handle = app.clone();
    let respawn_res = res.to_path_buf();
    let ready = Arc::new(AtomicBool::new(false));
    let ready_for_events = ready.clone();
    let owns_runtime = Arc::new(AtomicBool::new(false));
    let owns_runtime_for_events = owns_runtime.clone();
    // Set by the watchdog just before it kills a stuck attempt, so this attempt's
    // termination is understood as the retry it is and not reported as a crash.
    let retrying = Arc::new(AtomicBool::new(false));
    let retrying_for_events = retrying.clone();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let text = text.trim_end();
                    logln(format!("[api] {text}"));
                    if !text.is_empty() && !text.starts_with(READY_PREFIX) {
                        if let Ok(mut last) = handle.state::<ApiSidecar>().last_line.lock() {
                            *last = Some(text.chars().take(300).collect());
                        }
                    }
                    if let Some(payload) = text.strip_prefix(READY_PREFIX) {
                        match serde_json::from_str::<RuntimeReady>(payload)
                            .map_err(|error| error.into())
                            .and_then(|endpoint| {
                                owns_runtime_for_events
                                    .store(endpoint.pid == child_pid, Ordering::Release);
                                runtime_port(&endpoint.base_url)
                            }) {
                            Ok(actual_port) => {
                                ready_for_events.store(true, Ordering::Release);
                                logln(format!(
                                    "runtime ready on port {actual_port} after {:?}",
                                    started.elapsed()
                                ));
                                // A pre-existing compatible runtime may answer on a
                                // different port than the one reserved here. The
                                // handoff script itself decides whether the page is
                                // already addressing it and reloads only if not.
                                publish_status(&handle, "ready", None, Some(actual_port));
                            }
                            Err(error) => {
                                report_error(&handle, format!("invalid readiness frame: {error}"))
                            }
                        }
                    }
                }
                CommandEvent::Error(error) => {
                    report_error(&handle, format!("API process error: {error}"));
                }
                CommandEvent::Terminated(payload) => {
                    logln(format!("[api] TERMINATED pid={child_pid} {payload:?}"));
                    let sidecar = handle.state::<ApiSidecar>();
                    // Only THIS attempt's record. A stuck attempt killed by the watchdog reports
                    // its exit after the retry has already stored the next child; clearing the
                    // slot unconditionally dropped the live child's handle, so quit had nothing
                    // to stop and the retry outlived the app holding the database lease.
                    let exited =
                        take_for_pid(&mut sidecar.child.lock().unwrap(), child_pid, |managed| {
                            managed.child.pid()
                        });
                    // Dropping the record closes the tree: whatever the runtime left running ends
                    // with it.
                    drop(exited);
                    let ready = ready_for_events.load(Ordering::Acquire);
                    let owns_runtime = owns_runtime_for_events.load(Ordering::Acquire);
                    let stopping = sidecar.stopping.load(Ordering::Acquire);
                    if !should_report_termination(
                        ready,
                        owns_runtime,
                        stopping || retrying_for_events.load(Ordering::Acquire),
                        payload.code,
                    ) {
                        break;
                    }
                    if should_respawn(
                        ready,
                        owns_runtime,
                        stopping || sidecar.respawn_held.load(Ordering::Acquire),
                        sidecar.respawns.load(Ordering::Acquire),
                    ) {
                        sidecar.respawns.fetch_add(1, Ordering::AcqRel);
                        respawn_after_crash(&handle, respawn_res.clone(), payload.code);
                    } else {
                        report_error(
                            &handle,
                            format!(
                                "local API exited (code {:?}) — see ~/.localix/logs/api.log",
                                payload.code
                            ),
                        );
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    let timeout_handle = app.clone();
    let timeout_res = res.to_path_buf();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(READY_TIMEOUT_SECS));
        if ready.load(Ordering::Acquire) {
            return;
        }
        // A deliberate shutdown races this thread on quit; killing there is the
        // owner's job and re-spawning would resurrect the app on its way out.
        if timeout_handle
            .state::<ApiSidecar>()
            .stopping
            .load(Ordering::Acquire)
        {
            return;
        }
        let will_retry = attempt < READY_ATTEMPTS;
        retrying.store(will_retry, Ordering::Release);
        let stuck = take_for_pid(
            &mut timeout_handle.state::<ApiSidecar>().child.lock().unwrap(),
            child_pid,
            |managed| managed.child.pid(),
        );
        if let Some(managed) = stuck {
            let _ = managed.child.kill();
        }
        if !will_retry {
            report_error(&timeout_handle, timeout_message(&timeout_handle));
            return;
        }
        // A fresh port, because the previous one is one of the things that could
        // have been stuck — and the handoff script moves the page to whatever the
        // runtime actually answers on.
        let Ok(retry_port) = reserve_loopback_port() else {
            report_error(&timeout_handle, timeout_message(&timeout_handle));
            return;
        };
        logln(format!(
            "runtime start timed out after {READY_TIMEOUT_SECS}s; retrying on port {retry_port}"
        ));
        let _ = spawn_runtime(&timeout_handle, &timeout_res, retry_port, attempt + 1);
    });

    Ok(())
}

/// How long the runtime gets to honor `shutdown` before the shell kills it.
///
/// Longer than the runtime's OWN shutdown deadline (`apps/api/src/index.ts`), so a
/// healthy runtime always finishes on its own terms and this never fires. When it does
/// fire, the runtime is wedged and killing it is the only correct answer.
///
/// Quit has to MEAN closing the runtime: a quit that only wrote `shutdown\n` and let tauri end
/// the shell left a wedged runtime alive, holding the database lease, and the next launch
/// blocked on it. So the quit path (`quit::on_exit_requested`) defers the exit, flushes the
/// page, and then waits this long in [`stop_api_blocking`] before a kill.
pub(crate) const SHUTDOWN_WAIT: Duration = Duration::from_secs(6);

/// How long the `Exit` event may hold the process for a runtime that was never asked to stop.
///
/// `Exit` is the one event every way out raises, including the ones that never raise
/// `ExitRequested`: the macOS Dock's Quit and a logout (`terminate:` goes straight to
/// `applicationWillTerminate`), and a Windows `WM_QUIT`. Those used to reach only a bare kill, so
/// the runtime lost its `shutdown` handshake and the database close with it. The process is
/// already on its way out, though, and the OS may be waiting on it, so this grace is shorter than
/// [`SHUTDOWN_WAIT`]; a runtime that needs longer is killed as before.
pub(crate) const EXIT_GRACE: Duration = Duration::from_secs(3);

/// Stop the runtime and wait for it, bounded: `shutdown\n`, up to `grace` for it to exit on its
/// own, then a kill of whatever is left. Blocking by design — the callers are a quit thread, the
/// `Exit` event, and the updater's pre-exit hook, none of which may return while the runtime
/// still runs. Marks the sidecar `stopping` first, so the exit is neither reported as a crash nor
/// respawned. A no-op when there is no child (debug builds, or an earlier stop already done).
pub(crate) fn stop_api_blocking(app: &tauri::AppHandle, grace: Duration) {
    let sidecar = app.state::<ApiSidecar>();
    sidecar.stopping.store(true, Ordering::Release);
    match sidecar.child.lock().unwrap().as_mut() {
        Some(managed) => {
            let _ = managed.child.write(b"shutdown\n");
        }
        None => return,
    }
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        // The event task clears this on `Terminated`, so it going empty IS the child being
        // gone — no separate liveness probe to disagree with.
        if sidecar.child.lock().unwrap().is_none() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    kill_api_child(app, "did not exit within the shutdown grace");
}

/// Last resort: take the child and kill it, and its tree with it (`process_tree`). Idempotent —
/// a child already reaped by the event task has been cleared from the state.
fn kill_api_child(app: &tauri::AppHandle, why: &str) {
    let managed = app.state::<ApiSidecar>().child.lock().unwrap().take();
    if let Some(managed) = managed {
        logln(format!("killing managed API child: {why}"));
        let _ = managed.child.kill();
    }
}

/// Hold (or release) crash respawns while an update is installed. See `respawn_held`.
pub(crate) fn hold_respawns(app: &tauri::AppHandle, held: bool) {
    app.state::<ApiSidecar>()
        .respawn_held
        .store(held, Ordering::Release);
}

/// Take the recorded child only when it is the process `pid`. The slot is shared by successive
/// attempts, and an event about one attempt must never act on the next one's record.
fn take_for_pid<T>(slot: &mut Option<T>, pid: u32, pid_of: impl Fn(&T) -> u32) -> Option<T> {
    if slot
        .as_ref()
        .is_some_and(|recorded| pid_of(recorded) == pid)
    {
        slot.take()
    } else {
        None
    }
}

/// How many times per shell lifetime a runtime that died after `ready` is started again.
///
/// A crash after `ready` used to be final: the error was shown and only a full app restart —
/// the user's own, by hand — brought the workspace back. One respawn is that same action taken
/// for them. More than one would turn a runtime that crashes on every boot into a loop that keeps
/// reloading the page, so the second crash is reported exactly as before.
const MAX_RESPAWNS: u32 = 1;

/// The pause before a respawn: long enough for the dead runtime's lease and port to be released,
/// short enough that the user sees a reconnect rather than an outage.
const RESPAWN_BACKOFF: Duration = Duration::from_secs(1);

/// Whether a reported termination is a crash to recover from. Only a runtime this shell OWNED
/// and saw become ready: a start that never got there is the startup retry's job, and a runtime
/// that exits while the app quits or updates must stay down.
fn should_respawn(ready: bool, owns_runtime: bool, winding_down: bool, respawns: u32) -> bool {
    ready && owns_runtime && !winding_down && respawns < MAX_RESPAWNS
}

/// Start the runtime again after it died post-`ready`, on a fresh port. The page is told the
/// runtime is `starting` again, and the new `ready` hands it the new port through the same
/// idempotent handoff the first start used — which reloads the page onto it.
fn respawn_after_crash(app: &tauri::AppHandle, res: std::path::PathBuf, code: Option<i32>) {
    logln(format!(
        "runtime exited after ready (code {code:?}); respawning in {RESPAWN_BACKOFF:?}"
    ));
    publish_status(app, "starting", None, None);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(RESPAWN_BACKOFF);
        let sidecar = handle.state::<ApiSidecar>();
        if sidecar.stopping.load(Ordering::Acquire) || sidecar.respawn_held.load(Ordering::Acquire)
        {
            return;
        }
        match reserve_loopback_port() {
            Ok(port) => {
                let _ = spawn_runtime(&handle, &res, port, 1);
            }
            Err(error) => report_error(
                &handle,
                format!("local API exited and could not be restarted: {error}"),
            ),
        }
    });
}

fn should_report_termination(
    ready: bool,
    owns_runtime: bool,
    stopping: bool,
    code: Option<i32>,
) -> bool {
    !stopping && (!ready || owns_runtime || code != Some(0))
}

fn init_script(port: Option<u16>) -> String {
    let selected = port.map_or_else(
        || "undefined".into(),
        |port| format!("Number(sessionStorage.getItem('__localix_api_port'))||{port}"),
    );
    format!(
        "window.__LOCALIX_DESKTOP=true;window.__LOCALIX_API_PORT={selected};window.__LOCALIX_OAUTH_PORT=window.__LOCALIX_API_PORT;window.__LOCALIX_UPDATER=true;window.__LOCALIX_RUNTIME_STATUS='starting';window.__LOCALIX_RUNTIME_ERROR=null;"
    )
}

fn init_error_script(message: &str) -> String {
    let message = serde_json::to_string(message).unwrap_or_else(|_| "\"startup failed\"".into());
    format!(
        "window.__LOCALIX_DESKTOP=true;window.__LOCALIX_UPDATER=true;window.__LOCALIX_RUNTIME_STATUS='error';window.__LOCALIX_RUNTIME_ERROR={message};"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        format_timeout_message, plain_windows_path, should_report_termination, should_respawn,
        status_script, take_for_pid, MAX_RESPAWNS,
    };

    #[test]
    fn a_verbatim_path_gets_its_plain_spelling() {
        assert_eq!(
            plain_windows_path(r"\\?\C:\Program Files\Localix\resources"),
            r"C:\Program Files\Localix\resources"
        );
        // The case the old four-character strip broke into the relative `UNC\server\…`.
        assert_eq!(
            plain_windows_path(r"\\?\UNC\server\share\Localix\resources"),
            r"\\server\share\Localix\resources"
        );
        // No plain spelling exists; handing it on unchanged beats inventing one.
        let volume = r"\\?\Volume{12345678-1234-1234-1234-123456789abc}\Localix";
        assert_eq!(plain_windows_path(volume), volume);
        // Already plain, or not Windows at all.
        assert_eq!(plain_windows_path(r"C:\Localix"), r"C:\Localix");
        assert_eq!(
            plain_windows_path("/Applications/Localix.app"),
            "/Applications/Localix.app"
        );
    }

    #[test]
    fn an_exit_event_clears_only_its_own_attempts_record() {
        // The stuck attempt 1 (pid 10) was killed and attempt 2 (pid 20) already recorded when
        // attempt 1's `Terminated` arrives. It must leave attempt 2's record in place.
        let mut slot = Some(20_u32);
        assert_eq!(take_for_pid(&mut slot, 10, |pid| *pid), None);
        assert_eq!(slot, Some(20));
        assert_eq!(take_for_pid(&mut slot, 20, |pid| *pid), Some(20));
        assert_eq!(slot, None);
        assert_eq!(take_for_pid(&mut slot, 20, |pid| *pid), None);
    }

    #[test]
    fn only_an_owned_ready_runtime_dying_unasked_is_respawned_and_only_once() {
        assert!(should_respawn(true, true, false, 0));
        // The budget is spent: the next crash is reported, not looped on.
        assert!(!should_respawn(true, true, false, MAX_RESPAWNS));
        // Quitting or updating: it must stay down.
        assert!(!should_respawn(true, true, true, 0));
        // Never became ready: the startup retry owns that.
        assert!(!should_respawn(false, true, false, 0));
        // A runtime this shell only attached to is not ours to restart.
        assert!(!should_respawn(true, false, false, 0));
    }

    #[test]
    fn the_timeout_quotes_what_the_runtime_last_said() {
        // The whole point: the reason was already written down, and the old message
        // withheld it. "ownership held by pid N" IS the diagnosis.
        let message = format_timeout_message(Some("[startup] ownership held by pid 42"));
        assert!(message.contains("ownership held by pid 42"));
        assert!(message.starts_with("timed out waiting for the local API"));
    }

    #[test]
    fn a_silent_runtime_still_says_where_to_look() {
        // Not even the first line: the likely cause is named, and the log is still pointed at.
        let message = format_timeout_message(None);
        assert!(message.contains("never got to run its code"));
        assert!(message.contains("allow access to a folder"));
        assert!(message.contains(".localix/logs/api.log"));
    }

    #[test]
    fn a_runtime_that_loaded_and_went_quiet_is_not_blamed_on_macos() {
        let message = format_timeout_message(Some("[startup] runtime code loaded pid=42"));
        assert!(message.contains("started but never became ready"));
        assert!(!message.contains("allow access"));
    }

    #[test]
    fn status_script_reloads_only_when_the_page_addresses_another_port() {
        let script = status_script("ready", None, Some(4321));
        assert!(script.contains("window.__LOCALIX_API_PORT!==4321"));
        assert!(script.contains("window.location.reload()"));
        // The reload must sit INSIDE the mismatch branch: replaying this script on a
        // page already using the attested port has to be a no-op, not a reload loop.
        let after_guard = script
            .split("window.__LOCALIX_API_PORT!==4321")
            .nth(1)
            .unwrap();
        let reload_at = after_guard.find("window.location.reload()").unwrap();
        let branch_end = after_guard.find("return;}").unwrap();
        assert!(reload_at < branch_end);
    }

    #[test]
    fn status_script_without_a_port_only_announces_the_status() {
        let script = status_script("error", Some("boom"), None);
        assert!(!script.contains("location.reload"));
        assert!(script.contains(r#"window.__LOCALIX_RUNTIME_STATUS="error""#));
        assert!(script.contains(r#"window.__LOCALIX_RUNTIME_ERROR="boom""#));
        assert!(script.contains("localix-runtime-status"));
    }

    #[test]
    fn status_script_escapes_a_detail_that_would_otherwise_break_the_eval() {
        let script = status_script("error", Some("bad \"quote\"\nand newline"), None);
        assert!(!script.contains('\n'));
        assert!(script.contains(r#"\"quote\""#));
    }

    #[test]
    fn termination_policy_distinguishes_attach_handoff_from_owned_runtime_exit() {
        assert!(!should_report_termination(true, false, false, Some(0)));
        assert!(should_report_termination(true, true, false, Some(0)));
        assert!(should_report_termination(true, false, false, Some(1)));
        assert!(should_report_termination(false, false, false, Some(0)));
        assert!(!should_report_termination(true, true, true, Some(0)));
        assert!(!should_report_termination(true, true, true, Some(1)));
    }
}
