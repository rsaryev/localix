/**
 * A wall-clock deadline for every `bun test` process, and a lower CPU priority while it runs.
 *
 * The defect: a test process that hangs does not stop. `bun test`'s per-test timeout is a timer
 * on the SAME event loop, so a synchronous stall (an `execFileSync` whose child never exits) or a
 * native build spinning its worker threads never lets it fire. Such a process keeps several cores
 * and gigabytes busy until it is killed by hand, which makes the machine unusable.
 *
 * So the deadline lives OUTSIDE the process: a tiny detached `sh` loop that polls the test's pid
 * every few seconds and, past the limit, kills its children and then it. It exits on its own the
 * moment the test process is gone, and it costs nothing while it sleeps. The process also drops to
 * a lower scheduling priority, so even a legitimately heavy suite cannot starve the desktop.
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
const WATCHDOG = `
pid="$1"; limit="$2"; waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 5; waited=$((waited + 5))
  if [ "$waited" -ge "$limit" ]; then
    echo "test-deadline: bun test (pid $pid) ran past \${limit}s; killing it." >&2
    kids=$(pgrep -P "$pid" 2>/dev/null | grep -vx "$$")
    kill -9 $kids "$pid" 2>/dev/null; exit 0
  fi
done`

export function armTestDeadline(limitSeconds: number, pid = process.pid): void {
  if (armed || limitSeconds <= 0) return
  armed = true
  const watchdog = spawn('sh', ['-c', WATCHDOG, 'sh', String(pid), String(limitSeconds)], {
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  watchdog.unref()
}

try {
  // Nice 10: still gets every idle cycle, yields to the UI and the dev server first.
  setPriority(process.pid, 10)
} catch {
  // Not permitted or not supported on this platform — the deadline alone still applies.
}
const configured = Number(process.env.LOCALIX_TEST_DEADLINE_S ?? DEFAULT_TEST_DEADLINE_S)
armTestDeadline(Number.isFinite(configured) ? configured : DEFAULT_TEST_DEADLINE_S)
