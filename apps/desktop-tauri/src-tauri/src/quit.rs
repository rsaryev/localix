//! The before-quit handshake: every way out of the app lets the page save first.
//!
//! THE DEFECT. The page keeps its latest state in debounced writes — the editor grid (250 ms),
//! a caret/scroll position (400 ms), a settings edit (a PATCH 800 ms later), a half-typed
//! message. Quit used to end the process the moment `ExitRequested` arrived: in a development
//! build there is no API child, so nothing was waited for at all, and in a release build the
//! settings PATCH raced the runtime being told to shut down. Whatever the page had not written
//! yet was simply gone on the next launch, and a settings edit came back reverted because the
//! server copy won the sync barrier.
//!
//! THE SHAPE (Electron's `before-quit`; janhq/jan's app-exit event): the exit is deferred, the
//! page is told [`BEFORE_QUIT_EVENT`], it flushes every registered writer while the runtime is
//! still up and answers [`quit_ready`], and only then — or after [`FLUSH_BUDGET`], so a hung
//! page can never keep the app open — is the window geometry saved and the runtime stopped.
//! The handshake runs whether or not there is an API child: the page's writes are not the
//! runtime's.
//!
//! Tauri ignores `prevent_exit` for a restart, so a restart cannot be deferred from
//! `ExitRequested`. Each restart initiator (`restart_app`, the updater) therefore runs
//! [`leave_cleanly`] itself BEFORE it asks for the restart, and so does the Windows installer
//! hook, which leaves by `std::process::exit` without any event at all.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use tauri::{AppHandle, ExitRequestApi, Manager, RESTART_EXIT_CODE};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::log::logln;
use crate::sidecar::{stop_api_blocking, SHUTDOWN_WAIT};

/// Emitted to the main webview when the app is about to quit or restart.
pub(crate) const BEFORE_QUIT_EVENT: &str = "localix://before-quit";

/// The longest the page may hold a quit. The page bounds its own flush shorter than this
/// (`apps/ui/src/shared/lib/quitFlush.ts`), so a healthy page always answers first.
pub(crate) const FLUSH_BUDGET: Duration = Duration::from_millis(1500);

/// The window-state flags, one definition for the plugin and for the explicit saves here.
/// VISIBLE is excluded: the window is built hidden and revealed at first paint.
pub(crate) fn window_state_flags() -> StateFlags {
    let flags = StateFlags::all().difference(StateFlags::VISIBLE);
    // A tab group's fullscreen is restored after joining its windows, not per window.
    #[cfg(target_os = "macos")]
    let flags = flags.difference(StateFlags::FULLSCREEN);
    flags
}

const IDLE: u8 = 0;
const QUITTING: u8 = 1;
const RELEASED: u8 = 2;

/// Where the quit stands. One per process: a quit is never undone.
#[derive(Default)]
pub(crate) struct QuitState {
    phase: AtomicU8,
}

/// What `ExitRequested` does, given the phase it arrives in.
#[derive(Debug, PartialEq, Eq)]
enum Admission {
    /// First request: defer it and run the handshake.
    Start,
    /// A repeat (Cmd+Q pressed twice) while the handshake runs: swallowed, or it would cut
    /// the flush short.
    Hold,
    /// The handshake's own final `exit`, or a restart tauri will not let us defer.
    Proceed,
}

fn admit(phase: u8, restart: bool) -> Admission {
    match phase {
        _ if restart => Admission::Proceed,
        IDLE => Admission::Start,
        QUITTING => Admission::Hold,
        _ => Admission::Proceed,
    }
}

/// `RunEvent::ExitRequested`: defer the exit, flush the page, stop the runtime, then exit.
pub(crate) fn on_exit_requested(app: &AppHandle, api: &ExitRequestApi, code: Option<i32>) {
    let state = app.state::<QuitState>();
    let restart = code == Some(RESTART_EXIT_CODE);
    // `ExitRequested` is delivered on the main thread, one at a time, so reading the phase and
    // then storing it cannot interleave with another request.
    match admit(state.phase.load(Ordering::Acquire), restart) {
        Admission::Proceed => {
            // A restart's initiator already ran `leave_cleanly`; `Exit` backs up the stop.
            state.phase.store(RELEASED, Ordering::Release);
            return;
        }
        Admission::Hold => {
            api.prevent_exit();
            return;
        }
        Admission::Start => state.phase.store(QUITTING, Ordering::Release),
    }
    api.prevent_exit();
    let handle = app.clone();
    std::thread::spawn(move || {
        leave_cleanly(&handle);
        handle
            .state::<QuitState>()
            .phase
            .store(RELEASED, Ordering::Release);
        handle.exit(0);
    });
}

/// Everything a way out owes before the process ends, in order: the page saves while the
/// runtime can still take its writes, the window geometry is saved, then the runtime stops.
/// Blocking: call it off the main thread, which has to stay free to deliver both the event
/// and the page's `quit_ready`.
pub(crate) fn leave_cleanly(app: &AppHandle) {
    flush_frontend(app);
    stop_api_blocking(app, SHUTDOWN_WAIT);
}

/// Ask the page to save everything, wait for its answer (bounded), then save the window
/// geometry.
fn flush_frontend(app: &AppHandle) {
    let labels: Vec<_> = crate::workspace_windows::views(app)
        .iter()
        .map(|view| view.label().to_string())
        .collect();
    crate::frontend_flush::flush(app, &labels, false);
    #[cfg(target_os = "macos")]
    crate::workspace_session::save(app);
    // Here as well as on `Exit`: the Windows installer path leaves by `std::process::exit` and
    // never raises `Exit`, which is where the plugin itself saves.
    if let Err(error) = app.save_window_state(window_state_flags()) {
        logln(format!("before-quit: window state not saved ({error})"));
    }
}

#[cfg(test)]
mod tests {
    use super::{admit, Admission, IDLE, QUITTING, RELEASED};

    #[test]
    fn only_the_first_request_starts_the_handshake_and_a_repeat_cannot_cut_it_short() {
        assert_eq!(admit(IDLE, false), Admission::Start);
        assert_eq!(admit(QUITTING, false), Admission::Hold);
        assert_eq!(admit(RELEASED, false), Admission::Proceed);
        // tauri ignores prevent_exit for a restart; its initiator left cleanly already.
        assert_eq!(admit(IDLE, true), Admission::Proceed);
    }

    /// Every restart initiator leaves cleanly before it asks for the restart, because tauri
    /// will not let `ExitRequested` defer one. A new restart call site without it is the
    /// regression; this reads the sources, as `menu.rs` does for the Quit item.
    #[test]
    fn every_restart_is_preceded_by_a_flush() {
        for (name, source) in [
            ("commands.rs", include_str!("commands.rs")),
            ("updater.rs", include_str!("updater.rs")),
        ] {
            let code: String = source
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            let restarts: Vec<usize> = ["request_restart()", ".restart()"]
                .iter()
                .flat_map(|pattern| code.match_indices(pattern).map(|(at, _)| at))
                .collect();
            assert!(
                !restarts.is_empty(),
                "{name}: positive control — no restart call found"
            );
            for at in restarts {
                // The flush must sit in the SAME function, before the restart: a flush in some
                // other function (the Windows-only installer hook) does not run on this path.
                let before = &code[..at];
                let function_start = before.rfind("fn ").unwrap_or(0);
                let flush = before.rfind("leave_cleanly(");
                assert!(
                    flush.is_some_and(|flush| flush > function_start),
                    "{name}: a restart without leave_cleanly before it in the same function"
                );
            }
        }
    }
}
