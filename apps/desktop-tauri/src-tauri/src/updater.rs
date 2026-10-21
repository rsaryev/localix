//! Auto-update: check the configured endpoint, then download + install a signed
//! release and relaunch. Owns the progress-event throttle so the UI never has to.

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::log::logln;

/// Download progress is emitted at most twice a second; the UI only needs a moving percent.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

/// The `Update` handle produced by the most recent successful `updater_check`,
/// kept so `updater_install` can consume it directly instead of re-running the
/// network check. Re-checking on install is both a wasted round-trip and a race:
/// if `latest.json`/the endpoint changes or goes offline between the user seeing
/// "update available" and clicking "Install", the second check returns None and
/// the install fails with a spurious "no update available". Registered as
/// managed state in `run()`.
#[derive(Default)]
pub(crate) struct PendingUpdate(pub(crate) Mutex<Option<tauri_plugin_updater::Update>>);

/// The last check failure already written to the log.
///
/// An unreachable release feed fails on EVERY check, and the boot log is capped
/// at ~1 MiB with one generation kept — so a repeating failure quietly evicts the
/// startup diagnostics the file exists to preserve. One line per outage keeps the
/// condition visible without paying for it once an hour, forever. Recovery is
/// logged too, so the file says when it ended.
static LAST_CHECK_FAILURE: Mutex<Option<String>> = Mutex::new(None);

fn report_check_failure(message: String) {
    let Ok(mut last) = LAST_CHECK_FAILURE.lock() else {
        return;
    };
    if last.as_deref() == Some(message.as_str()) {
        return;
    }
    logln(format!("updater_check failed: {message}"));
    *last = Some(message);
}

fn report_check_success() {
    let Ok(mut last) = LAST_CHECK_FAILURE.lock() else {
        return;
    };
    if last.take().is_some() {
        logln("updater_check recovered");
    }
}

/// Every updater this shell uses — built here so none is built without the hook below.
///
/// On Windows `install` runs the pre-exit hook, launches the installer and calls
/// `std::process::exit(0)`: no `ExitRequested`, no `Exit`, none of the shell's own stop paths.
/// The plugin's default hook only clears tauri's resources, so bun and everything under it stayed
/// alive while the installer tried to replace the files they held open. A custom hook REPLACES
/// the default one, so this one does both: leaves cleanly (the page flushes, the window geometry
/// is saved — `Exit`, where the window-state plugin saves it, never comes — and the runtime is
/// stopped, bounded, then killed), then runs the same `cleanup_before_exit` the default did. The
/// hook travels with each `Update` this updater returns, which is why the check must use it too,
/// not only the install.
fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let handle = app.clone();
    app.updater_builder()
        .on_before_exit(move || {
            logln("update installer starting: flushing the page and stopping the local API first");
            crate::quit::leave_cleanly(&handle);
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(|e| e.to_string())
}

/// Whether this build can update itself: true only for a release build (`build.rs`). A build from a
/// checkout has no updater plugin and no feed to read, so it is never offered an update; without
/// this, every local build (version 0.0.1) read the official feed and offered to replace itself.
pub(crate) const UPDATER_ENABLED: bool = cfg!(localix_updater);

/// Result of an update check, mirrored by the UI's `useDesktopUpdate` hook.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    available: bool,
    current_version: String,
    latest_version: Option<String>,
    /// The release notes the feed carries for `latest_version`, when it has any.
    notes: Option<String>,
}

/// Check the configured updater endpoint (the release overlay's `plugins.updater`)
/// for a newer signed release. Returns the current + latest version and whether
/// an update is available. Never errors the caller for a routine "no network" —
/// only a genuinely malformed setup surfaces as an Err string the UI can show.
#[tauri::command]
pub(crate) async fn updater_check(app: AppHandle) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    if !UPDATER_ENABLED {
        return Ok(UpdateStatus {
            current_version: current,
            ..Default::default()
        });
    }
    let updater = updater(&app)?;
    match updater.check().await {
        Ok(Some(update)) => {
            // Stash the handle so updater_install can consume it without a second
            // check() (see PendingUpdate). Read the version out first, then move.
            let latest_version = Some(update.version.clone());
            let notes = update.body.clone().filter(|body| !body.trim().is_empty());
            *app.state::<PendingUpdate>().0.lock().unwrap() = Some(update);
            report_check_success();
            Ok(UpdateStatus {
                available: true,
                current_version: current,
                latest_version,
                notes,
            })
        }
        Ok(None) => {
            // No update: clear any stale handle from an earlier check.
            *app.state::<PendingUpdate>().0.lock().unwrap() = None;
            report_check_success();
            Ok(UpdateStatus {
                available: false,
                current_version: current,
                latest_version: None,
                notes: None,
            })
        }
        Err(e) => {
            report_check_failure(e.to_string());
            Ok(UpdateStatus {
                current_version: current,
                ..Default::default()
            })
        }
    }
}

/// Download + install the available update (signature-verified against the
/// configured pubkey), then relaunch into the new version. The download runs to
/// completion before the install; on success the process restarts and this call
/// never returns. Download progress is surfaced to the UI as throttled
/// `updater:progress` events ({downloaded, total}) so a large bundle (~90MB with
/// the Bun sidecar) doesn't look frozen.
#[tauri::command]
pub(crate) async fn updater_install(app: AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    if !UPDATER_ENABLED {
        return Err("this build has no updater".into());
    }
    // Prefer the handle cached by the UI's preceding updater_check (no redundant
    // network call, no check→install race). Fall back to a fresh check only if
    // install is somehow reached without a prior check.
    let cached = app.state::<PendingUpdate>().0.lock().unwrap().take();
    let update = match cached {
        Some(update) => update,
        None => {
            let updater = updater(&app)?;
            let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
                return Err("no update available".into());
            };
            update
        }
    };
    // Shared across the two callbacks (chunk + finish), which borrow it immutably.
    let downloaded = std::sync::atomic::AtomicU64::new(0);
    let mut last_emit: Option<Instant> = None;
    // From here to the relaunch a crashed runtime stays down: the bundle a respawn would load is
    // the one about to be replaced. Released again if the install fails.
    crate::sidecar::hold_respawns(&app, true);
    let installed = update
        .download_and_install(
            |chunk, total| {
                let d = downloaded.fetch_add(chunk as u64, Ordering::Relaxed) + chunk as u64;
                // Throttle to ~2 events/s; the UI only needs a moving percent.
                if last_emit.is_none_or(|t| t.elapsed() >= PROGRESS_INTERVAL) {
                    last_emit = Some(Instant::now());
                    let _ = app.emit(
                        "updater:progress",
                        serde_json::json!({ "downloaded": d, "total": total }),
                    );
                }
            },
            || {
                logln("update download finished");
                let d = downloaded.load(Ordering::Relaxed);
                let _ = app.emit(
                    "updater:progress",
                    serde_json::json!({ "downloaded": d, "total": d }),
                );
            },
        )
        .await;
    if let Err(e) = installed {
        logln(format!("updater_install failed: {e}"));
        crate::sidecar::hold_respawns(&app, false);
        return Err(e.to_string());
    }
    // macOS/Linux (Windows never returns from the install). tauri will not let `ExitRequested`
    // defer a restart, so the page's flush and the runtime's stop happen here, first.
    let leaving = app.clone();
    let _ =
        tauri::async_runtime::spawn_blocking(move || crate::quit::leave_cleanly(&leaving)).await;
    app.restart();
}
