/**
 * A wall-clock deadline for every `bun test` process, and a lower CPU priority while it runs.
 *
 * The defect: a test process that hangs does not stop. `bun test`'s per-test timeout is a timer
 * on the SAME event loop, so a synchronous stall (an `execFileSync` whose child never exits) or a
 * native build spinning its worker threads never lets it fire. Such a process keeps several cores
 * and gigabytes busy until it is killed by hand, which makes the machine unusable.
 *
 * So the deadline lives OUTSIDE the process: a tiny detached `sh` that, past the limit, kills the
 * test's children and then it. The process also drops to a lower scheduling priority, so even a
 * legitimately heavy suite cannot starve the desktop.
 *
 * The watchdog learns that the test is gone from its stdin, a pipe only the test process holds
 * open: when the process exits, for any reason, `cat` reads EOF and the watchdog leaves at once. It
 * used to poll the pid every 5 s with the test's stderr inherited, so whoever read that stderr (a
 * Turbo task, a CI step, a shard runner) waited up to 5 s after the tests had finished. That was
 * most of the wall time of every small package's `test`.
 *
 * `LOCALIX_TEST_DEADLINE_S` overrides the limit (0 disables it, e.g. to debug with a breakpoint).
 */
import { spawn } from 'node:child_process'
import { setPriority } from 'node:os'

/** Long enough for the whole UI suite on a slow machine; short enough that a hang dies. */
export const DEFAULT_TEST_DEADLINE_S = 15 * 60
// Module state, not a `globalThis` key: the preload runs once per process, and
// `test-globals-guard` rightly fails a run that leaves keys on the global object.
let armed = false

// The watchdog is itself a child of the process it watches, so `pkill -P "$pid"` would kill the
// watchdog before it reached `kill -9 "$pid"` and the stuck process would live on. The children
// are listed first, minus this shell, and everything dies in one `kill`.
//
// The timer is a background `sleep` holding none of the test's streams. A reader cancels it when
// the liveness pipe closes; `wait` then tells the two endings apart: a cancelled timer means the
// test exited on its own and nothing is killed (its pid may already belong to another process).
const WATCHDOG = `
pid="$1"; limit="$2"
# A background job's stdin is /dev/null in sh, so the reader takes the pipe through fd 3.
exec 3<&0
sleep "$limit" </dev/null >/dev/null 2>&1 &
timer=$!
(cat <&3 >/dev/null; kill "$timer" 2>/dev/null) &
exec 3<&-
if { wait "$timer"; } 2>/dev/null; then
  echo "test-deadline: bun test (pid $pid) ran past \${limit}s; killing it." >&2
  kids=$(pgrep -P "$pid" 2>/dev/null | grep -vx "$$")
  kill -9 $kids "$pid" 2>/dev/null
fi
exit 0`

export function armTestDeadline(limitSeconds: number, pid = process.pid): void {
  if (armed || limitSeconds <= 0) return
  armed = true
  const watchdog = spawn('sh', ['-c', WATCHDOG, 'sh', String(pid), String(limitSeconds)], {
    detached: true,
    // stdin is the liveness pipe: never written, closed by the kernel when this process exits.
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  watchdog.unref()
  // The open pipe must not keep this process's event loop alive on its own.
  ;(watchdog.stdin as unknown as { unref?: () => void } | null)?.unref?.()
}

try {
  // Nice 10: still gets every idle cycle, yields to the UI and the dev server first.
  setPriority(process.pid, 10)
} catch {
  // Not permitted or not supported on this platform — the deadline alone still applies.
}
const configured = Number(process.env.LOCALIX_TEST_DEADLINE_S ?? DEFAULT_TEST_DEADLINE_S)
armTestDeadline(Number.isFinite(configured) ? configured : DEFAULT_TEST_DEADLINE_S)
