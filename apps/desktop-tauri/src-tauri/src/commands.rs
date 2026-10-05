//! The shell commands the UI invokes directly — native affordances the webview
//! cannot reach on its own: an OS notification, opening a link in the real browser,
//! syncing native chrome to the app theme, the dock/taskbar badge, a native save
//! dialog, the window title, and the macOS drag-pasteboard path recovery.
//!
//! These are genuinely a GRAB-BAG, and grouping them is a judgment call: what they
//! share is not a domain but a direction — each is a thin, self-contained hop from
//! the webview out to an OS API, with no state between them. Kept together so
//! lib.rs stays a composition root; each is small enough to read in place.

use tauri::{AppHandle, Manager};

use crate::deeplink::is_external_url;
use crate::log::logln;
use crate::prefs::save_theme;

/// Return to the application after a user-initiated provider sign-in completes.
#[tauri::command]
pub(crate) fn focus_app(app: AppHandle) {
    crate::deeplink::show_main_window(&app);
}

/// Full-process recovery for a failed managed API boot. Relaunching is safer than
/// trying to replace a child while its SQLite lease and shutdown hooks are still
/// draining, and works uniformly on every desktop OS.
///
/// `async` + `request_restart`, never a sync command calling `restart()`. A sync
/// command runs on the MAIN thread, where tauri's `restart()` skips `ExitRequested`
/// and `Exit` and relaunches directly — so the old runtime was never stopped and the
/// new process started against the lease it still held.
///
/// tauri ignores `prevent_exit` for a restart, so `ExitRequested` cannot hold one for
/// the page's flush or the runtime's stop. Both happen here first (`leave_cleanly`,
/// blocking, so on the blocking pool), then tauri relaunches on the final `Exit`.
#[tauri::command]
pub(crate) async fn restart_app(app: AppHandle) {
    let leaving = app.clone();
    let _ =
        tauri::async_runtime::spawn_blocking(move || crate::quit::leave_cleanly(&leaving)).await;
    app.request_restart();
}

/// Mirror a narrow, user-safe webview diagnostic into the packaged shell log.
/// WKWebView release builds have no convenient console, so otherwise a failed
/// bootstrap fetch is invisible. Bound and flatten input before writing it.
#[tauri::command]
pub(crate) fn frontend_log(scope: String, message: String) {
    let clean_scope: String = scope
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(80)
        .collect();
    let clean_message: String = message
        .chars()
        .map(|c| if matches!(c, '\n' | '\r') { ' ' } else { c })
        .take(2_000)
        .collect();
    crate::log::log_ui(&clean_scope, &clean_message);
}

/// Is this path an app bundle itself (rather than a plain directory, or something
/// inside a bundle)? The path half of [`has_app_bundle`].
#[cfg(target_os = "macos")]
fn is_app_bundle_path(path: &str) -> bool {
    path.trim_end_matches('/').ends_with(".app")
}

/// Does this process run from a real `.app` bundle?
///
/// `UNUserNotificationCenter.currentNotificationCenter` does not fail softly
/// without one: it raises NSInternalInconsistencyException
/// ("bundleProxyForCurrentProcess is nil"), and an Objective-C exception on a
/// worker thread aborts the whole process. Under `tauri dev` the binary IS
/// unbundled (`target/debug/desktop-tauri`), so a single background notification
/// — a finished run, a HITL prompt — takes the app down mid-session. The `Err`
/// fallback in `notify` can never catch it: nothing returns an `Err`, the runtime
/// calls `abort()`.
///
/// The probe is the bundle PATH, not `bundleIdentifier`. The identifier is the
/// obvious-looking check and it is wrong here: Tauri embeds an `Info.plist` into
/// the executable (the `embed_plist` dependency), so an unbundled dev binary
/// still reports one and the guard walks straight into the crash. What
/// LaunchServices has no record of is a bundle DIRECTORY — which is exactly what
/// the exception text names: `mainBundle.bundleURL file:///…/target/debug/`.
#[cfg(target_os = "macos")]
fn has_app_bundle() -> bool {
    // `is_dev()` as well as the path: this crash aborts the process, so the dev
    // loop must not hinge on one AppKit probe being right. A packaged build is
    // never `is_dev()`, so prod loses nothing.
    !tauri::is_dev()
        && is_app_bundle_path(
            &objc2_foundation::NSBundle::mainBundle()
                .bundlePath()
                .to_string(),
        )
}

/// Show a native OS notification for a notable event (pending HITL request, a
/// finished run). Invoked from the UI via `invoke('notify', …)` — the Tauri
/// replacement for the old Electrobun `POST /desktop/notify` route (the API is a
/// separate process now, so it can't reach the shell over HTTP).
///
/// Rechecks focus at the native boundary to close the race after the webview's
/// policy decision. Only an explicit `always` may pass while focused; malformed
/// values retain the conservative unfocused-only behavior.
#[tauri::command]
pub(crate) fn notify(
    app: tauri::AppHandle,
    title: String,
    body: Option<String>,
    condition: Option<String>,
) {
    use tauri::Manager;
    use tauri_plugin_notification::NotificationExt;

    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if focused && condition.as_deref() != Some("always") {
        return;
    }

    // The Tauri plugin still uses deprecated NSUserNotificationCenter on macOS.
    // Use Apple's current UNUserNotificationCenter API — but ONLY when this
    // process is a real .app bundle. See `has_app_bundle`.
    #[cfg(target_os = "macos")]
    if !has_app_bundle() {
        let mut builder = app.notification().builder().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        if let Err(e) = builder.show() {
            logln(format!("notify (unbundled) failed: {e}"));
        }
        return;
    }

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            match mac_usernotifications::blocking::request_auth() {
                Ok(true) => {
                    let mut notification = mac_usernotifications::Notification::new().title(&title);
                    if let Some(body) = body.as_deref() {
                        notification = notification.message(body);
                    }
                    if let Err(e) = notification.send_blocking() {
                        logln(format!("notify failed: {e}"));
                    }
                }
                Ok(false) => logln("notification permission is denied"),
                Err(e) => {
                    logln(format!("notification permission request failed: {e}"));
                    if tauri::is_dev() {
                        let mut builder = app.notification().builder().title(title);
                        if let Some(body) = body {
                            builder = builder.body(body);
                        }
                        if let Err(fallback_error) = builder.show() {
                            logln(format!("notification fallback failed: {fallback_error}"));
                        }
                    }
                }
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut builder = app.notification().builder().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        if let Err(e) = builder.show() {
            logln(format!("notify failed: {e}"));
        }
    }
}

/// Open an external URL (http/https/mailto/tel) in the OS default browser/handler.
/// Anchor clicks and `window.open` inside the webview don't reliably reach the
/// `on_navigation`/`on_new_window` guards on every platform, so the UI routes
/// genuine external links through this command explicitly.
fn allowed_external_url(raw: &str) -> bool {
    let Ok(url) = tauri::Url::parse(raw) else {
        return false;
    };
    is_external_url(&url)
}

/// FAILS LOUDLY, on purpose. This used to return `()` and swallow both refusal and
/// OS error into the shell log, so `invoke('open_external')` ALWAYS resolved — the
/// caller's `.catch()` fallback could never run and a link that opened nothing was
/// indistinguishable from one that worked. Every caller preventDefaults the anchor
/// first (see `openExternal.ts`), which also denies `on_navigation` its chance to
/// act as the backstop, so a silent `Ok` here left no mechanism at all. Returning
/// `Result` is what lets the UI fall back and, failing that, tell the user.
#[tauri::command]
pub(crate) async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !allowed_external_url(&url) {
        logln("open_external blocked an unsupported URL");
        return Err("Only http, https, mailto and tel links can be opened.".into());
    }
    // Every attempt is recorded, not only the failures. With only a failure line,
    // "the log is empty" could mean the command was never called OR that it ran
    // and the OS quietly did nothing — and those two demand opposite fixes. That
    // ambiguity is what made a dead link un-diagnosable for an entire session.
    logln(format!("open_external → {url}"));

    #[cfg(target_os = "macos")]
    {
        let _ = &app;
        open_url_macos(url).await
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| {
                logln(format!("open_external failed: {e}"));
                format!("The system handler refused this link: {e}")
            })
    }
}

/// Hand the URL to LaunchServices and WAIT for the answer.
///
/// The opener plugin reaches `open::that_detached`, which spawns `/usr/bin/open`
/// and returns as soon as the CHILD STARTS. It therefore reports success for a URL
/// LaunchServices then refuses, which is exactly how a click could shift focus —
/// the OS beginning to activate a handler — while nothing ever opened, with an
/// empty log and an `Ok` on the wire. Waiting on the process turns that into a
/// real exit status, and its stderr into a sentence someone can act on.
#[cfg(target_os = "macos")]
async fn open_url_macos(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Absolute path, like the crate this replaces: never PATH-dependent.
        let output = std::process::Command::new("/usr/bin/open")
            .arg(&url)
            .output()
            .map_err(|e| {
                logln(format!("open_external: could not run /usr/bin/open: {e}"));
                format!("The system opener could not be started: {e}")
            })?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        logln(format!(
            "open_external failed: /usr/bin/open exited {} — {stderr}",
            output.status
        ));
        Err(if stderr.is_empty() {
            format!("The system opener refused this link ({}).", output.status)
        } else {
            stderr
        })
    })
    .await
    .map_err(|e| {
        logln(format!("open_external: opener task failed: {e}"));
        "The system opener could not be started.".to_string()
    })?
}

/// Sync the native window/OS chrome to the app's resolved theme so the macOS
/// traffic lights, native context menus and scrollbars (and the Windows menu bar)
/// match the UI's dark/light. "system" (or anything unrecognized) follows the OS.
#[tauri::command]
pub(crate) fn set_theme(app: AppHandle, theme: String, material_theme: Option<String>) {
    use tauri::Theme;
    let resolved = match theme.as_str() {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_theme(resolved);
        // The native window MATERIAL (vibrancy) is a separate thing from the theme above — it
        // needs its own concrete NSVisualEffectMaterial per appearance (see window_material.rs),
        // and only macOS has one to re-attach. System chrome remains automatic while the UI
        // supplies its resolved appearance, so an OS theme flip also updates the material.
        #[cfg(target_os = "macos")]
        if let Some(appearance) =
            crate::window_material::Appearance::parse(material_theme.as_deref().unwrap_or(&theme))
        {
            if let Err(error) = crate::window_material::apply(&w, appearance) {
                logln(format!("window material: re-attach failed ({error})"));
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = material_theme;
    crate::native_browser::apply_browser_theme(&app, &theme);
    // Remember it so the next launch can paint the startup background to match.
    save_theme(
        &app,
        match theme.as_str() {
            "dark" => Some("dark"),
            "light" => Some("light"),
            _ => None,
        },
    );
}

/// Set the dock/taskbar badge count (e.g. background HITL requests awaiting the
/// user). `0` clears it. macOS shows a red dock badge; Linux (Unity/GNOME) shows
/// a launcher count; Windows has no numeric badge, so a red-dot taskbar overlay
/// icon stands in (the OS convention for "needs attention").
#[tauri::command]
pub(crate) fn set_badge(app: AppHandle, count: i64) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count) } else { None });
        #[cfg(windows)]
        {
            let _ = w.set_overlay_icon(if count > 0 {
                Some(tauri::include_image!("icons/badge-overlay.png"))
            } else {
                None
            });
        }
    }
}

/// Save arbitrary bytes to a user-chosen path via a NATIVE save dialog. The UI
/// invokes this instead of the web `<a download>` trick, which WKWebView (macOS)
/// doesn't honor for blob: URLs — so exports (session Markdown, chart PNG/SVG,
/// table CSV) work reliably AND land where the user picks, like a native app.
/// `contents` is base64 so text and binary go through one path.
/// `Ok(None)` is a CANCEL and `Err` is a failure — they must not share a value.
///
/// This used to return `()` and run the dialog through a CALLBACK, so the command
/// resolved before the user had even chosen a destination and every later error
/// (a bad path, a failed write) reached only the shell log. The webview's own
/// comment concluded from the early resolve that "a rejection means the command
/// itself is unavailable" — which is how a person could pick a folder, click Save,
/// and end up with no file and no message. Awaiting the blocking dialog off the
/// main thread is what lets the outcome be reported at all.
#[tauri::command]
pub(crate) async fn save_file(
    app: AppHandle,
    filename: String,
    contents: String,
) -> Result<Option<String>, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents.as_bytes())
        .map_err(|e| {
            logln(format!("save_file: base64 decode failed: {e}"));
            "The export could not be encoded for saving.".to_string()
        })?;

    // `blocking_*` off the main thread: the plugin dispatches the dialog to the UI
    // thread itself, so blocking HERE would deadlock the loop it needs.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .set_file_name(&filename)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| {
            logln(format!("save_file: bad path: {e}"));
            format!("That destination could not be used: {e}")
        })?;
        std::fs::write(&path, &bytes).map_err(|e| {
            logln(format!("save_file: write {path:?} failed: {e}"));
            format!("The file could not be written: {e}")
        })?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| {
        logln(format!("save_file: dialog task failed: {e}"));
        "The save dialog could not be opened.".to_string()
    })?
}

/// One entry still sitting on the macOS DRAG pasteboard after an OS file drop.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DraggedPath {
    path: String,
    is_dir: bool,
}

/// The absolute FS paths of the files from the most recent OS drag session,
/// read from the macOS DRAG pasteboard (`NSPasteboardNameDrag`).
///
/// Why: the shell keeps Tauri's native drag-drop handler DISABLED (it swallows
/// all webview drops, incl. in-page HTML5 DnD — see the window-builder comment),
/// so drops arrive as normal HTML5 events whose `File`s hide the absolute path.
/// The pasteboard, however, still holds the just-dropped files' real paths
/// (AppKit doesn't clear it until the next drag), so the UI's drop router calls
/// this right after a `drop` event and matches the entries to
/// `dataTransfer.files` by name — matched files open EDITABLE in place instead
/// of as a read-only media copy. Stale/mismatched contents are harmless: the
/// UI verifies names and falls back to the media route.
///
/// `async` so the command runs off the main thread and can block briefly on the
/// main-thread hop (NSPasteboard is main-thread-preferred). Empty on non-macOS.
#[tauri::command]
pub(crate) async fn dragged_paths(app: AppHandle) -> Vec<DraggedPath> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        if app
            .run_on_main_thread(move || {
                let _ = tx.send(read_drag_pasteboard_paths());
            })
            .is_ok()
        {
            if let Ok(paths) = rx.recv_timeout(std::time::Duration::from_millis(500)) {
                return paths;
            }
        }
        Vec::new()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Vec::new()
    }
}

/// Read the drag pasteboard's file list (`NSFilenamesPboardType` property list —
/// deliberately the SAME deprecated type wry's own drag handler reads, so this
/// sees exactly what a native-handler build would). Must run on the main thread.
#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn read_drag_pasteboard_paths() -> Vec<DraggedPath> {
    use objc2_app_kit::{NSFilenamesPboardType, NSPasteboard, NSPasteboardNameDrag};
    use objc2_foundation::{NSArray, NSString};
    unsafe {
        let pb = NSPasteboard::pasteboardWithName(NSPasteboardNameDrag);
        let Some(list) = pb.propertyListForType(NSFilenamesPboardType) else {
            return Vec::new();
        };
        let Ok(arr) = list.downcast::<NSArray>() else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|item| item.downcast::<NSString>().ok())
            .filter_map(|s| {
                let path = s.to_string();
                // A path that does not EXIST is dropped rather than reported. The drag
                // pasteboard can name a file that was never written: drag the macOS
                // screenshot thumbnail out of the corner before it lands on the Desktop
                // and the promised name is all there is. Reporting it made the composer
                // prefer a copy-free `path` attachment over the real bytes sitting in the
                // drop's own `File`, so the picture the user dragged became "this file is
                // no longer available". Dropping the entry breaks the strict count match
                // in `matchDroppedPaths`, which is exactly the signal that sends the drop
                // down the byte-carrying media route instead.
                let meta = std::fs::metadata(&path).ok()?;
                Some(DraggedPath {
                    path,
                    is_dir: meta.is_dir(),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::allowed_external_url;

    #[test]
    fn external_url_allowlist_accepts_only_browser_and_mail_targets() {
        assert!(allowed_external_url("https://localix.dev/docs?q=agent"));
        assert!(allowed_external_url("http://127.0.0.1:5050/path"));
        assert!(allowed_external_url("mailto:hello@localix.dev?subject=Hi"));
        assert!(allowed_external_url("tel:+35799123456"));

        assert!(!allowed_external_url("file:///etc/passwd"));
        assert!(!allowed_external_url("javascript:alert(1)"));
        assert!(!allowed_external_url("data:text/html,hello"));
        assert!(!allowed_external_url("localix://session/LOCALIX-1"));
        assert!(!allowed_external_url("not a url"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn only_a_bundle_directory_may_reach_unusernotificationcenter() {
        use super::is_app_bundle_path;
        assert!(is_app_bundle_path("/Applications/Localix.app"));
        // NSBundle may or may not hand back a trailing slash.
        assert!(is_app_bundle_path("/Applications/Localix.app/"));
        // `tauri dev` runs the bare executable out of the build directory — the
        // case that aborts the process if it reaches UNUserNotificationCenter.
        assert!(!is_app_bundle_path("target/debug"));
        // Inside a bundle is not the bundle.
        assert!(!is_app_bundle_path(
            "/Applications/Localix.app/Contents/MacOS"
        ));
    }
}

/// Set the native window title (taskbar / window-switcher). Invoked from the UI
/// so the OS window title follows the active session, matching browser-tab
/// behavior. No visible effect on macOS (the title is hidden via
/// `hidden_title`), but harmless there; on Windows/Linux it updates the visible
/// title bar and taskbar entry.
#[tauri::command]
pub(crate) fn set_title(app: AppHandle, title: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(&title);
    }
}

/// Native folder picker, through the platform's own dialog.
///
/// The desktop path used to reach the API's REST picker, which shells out
/// per-platform: `osascript` on macOS, `powershell` on Windows, then `zenity`
/// falling back to `kdialog` on Linux. Two problems with that. It is exactly the
/// per-OS hardcoding this app is supposed to avoid, and on Linux it is not even
/// reliable — neither zenity nor kdialog is guaranteed present, so on a minimal
/// desktop "Open Folder" silently returned nothing.
///
/// `tauri-plugin-dialog` is already a registered plugin with its capability
/// granted, and it reaches the real native dialog on every target Tauri supports
/// with no external binary. The REST picker stays as the BROWSER path, where
/// there is no shell to ask.
///
/// `Ok(None)` is a user cancel, and callers must treat it as one — not as "the
/// picker is unavailable", which would open a second dialog on top of the first.
/// `Err` is that other thing: a picker that could not run at all, which the
/// webview answers by falling back to its REST picker.
///
/// The two were the SAME VALUE until this returned `Result`. `.unwrap_or_default()`
/// turned a panicked `spawn_blocking` join into `None`, so a picker the OS refused
/// was indistinguishable from a user pressing Escape, and "Open Folder" did nothing
/// with nothing to say about it.
#[tauri::command]
pub(crate) async fn pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // `blocking_*` off the main thread: the plugin dispatches the dialog to the
    // UI thread itself, and blocking HERE would deadlock the very loop it needs.
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| {
        logln(format!("pick_directory: dialog task failed: {e}"));
        "The folder picker could not be opened.".to_string()
    })
}

/// Native multi-file picker — the file counterpart of [`pick_directory`], with
/// the same reasoning, the same cancel semantics (an empty list is a cancel) and
/// the same reason for returning `Result`: a refused picker must not arrive as
/// an empty selection.
///
/// `extensions` (lower-case, no dot) preselects the dialog's filter so a caller
/// that can only open certain types — the reader's book picker, say — does not
/// invite a pick it will have to refuse. The dialog still offers "All files", so
/// the filter is a hint and callers keep validating the result.
#[tauri::command]
pub(crate) async fn pick_files(
    app: AppHandle,
    extensions: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(extensions) = extensions.as_ref().filter(|list| !list.is_empty()) {
            let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
            dialog = dialog.add_filter("Supported files", &refs);
        }
        dialog
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<String>>()
    })
    .await
    .map_err(|e| {
        logln(format!("pick_files: dialog task failed: {e}"));
        "The file picker could not be opened.".to_string()
    })
}
