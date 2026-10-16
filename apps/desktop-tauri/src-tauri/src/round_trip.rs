//! Bounded hops to the main thread and back.
//!
//! A command that needs an AppKit or WebKit answer sends the work to the main queue and waits on a
//! channel. The wait always has a deadline so a wedged main thread fails one command instead of
//! hanging an IPC worker forever.
use std::sync::mpsc;
use std::time::Duration;

/// Waits for one reply on a blocking worker so the async runtime keeps serving other commands.
pub(crate) async fn await_reply<T: Send + 'static>(
    reply: mpsc::Receiver<T>,
    timeout: Duration,
    timeout_error: &'static str,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        reply
            .recv_timeout(timeout)
            .map_err(|_| timeout_error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Runs `work` on the main queue, outside Tao's non-reentrant callbacks, and awaits its result.
#[cfg(target_os = "macos")]
pub(crate) async fn run_on_main<T: Send + 'static>(
    timeout: Duration,
    timeout_error: &'static str,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (sender, reply) = mpsc::channel();
    crate::main_queue::defer(move || {
        let _ = sender.send(work());
    });
    await_reply(reply, timeout, timeout_error).await
}

/// Blocking form of [`run_on_main`] for a caller already off the main thread. Calling it on the
/// main thread would wait for work queued behind itself, so it only ever times out there.
#[cfg(target_os = "macos")]
pub(crate) fn run_on_main_sync<T: Send + 'static>(
    timeout: Duration,
    work: impl FnOnce() -> T + Send + 'static,
) -> Option<T> {
    let (sender, reply) = mpsc::channel();
    crate::main_queue::defer(move || {
        let _ = sender.send(work());
    });
    reply.recv_timeout(timeout).ok()
}
