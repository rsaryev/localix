/**
 * The only channel a runtime has BEFORE `bootstrap()` exists.
 *
 * Everything the API says normally goes through `runtime.logger`, which is created by
 * `bootstrap()`. Ownership resolution, endpoint discovery and the port bind all happen
 * EARLIER than that, and they used to say nothing at all: the pre-bootstrap log
 * destination is opened but closed again without a write on the failure path, and
 * nothing was ever written to stderr.
 *
 * The consequence was the whole user-visible bug. A start that blocked on a wedged
 * ownership holder produced twenty seconds of total silence, the desktop shell killed it
 * at its own deadline, and the only thing anyone ever saw was "timed out waiting for the
 * local API" — a message that names the symptom and nothing else.
 *
 * stderr is the right channel precisely because the desktop shell already reads it: every
 * line the child writes is mirrored into `~/.localix/logs/desktop.log` tagged `[api] …`
 * (`sidecar.rs`), so a diagnostic emitted here reaches the crash log of a packaged app
 * with no wiring at all. In a terminal it is simply printed.
 */
export function startupDiag(message: string): void {
  try {
    process.stderr.write(`[startup] ${message}\n`)
  } catch {
    // A closed/broken stderr must never be the reason a startup path fails.
  }
}
