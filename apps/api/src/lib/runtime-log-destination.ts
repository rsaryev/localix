import pino from 'pino'
import { chmodSync, closeSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { envString, resolveDbFile } from './env'

/**
 * The API's log: `logs/api.log` beside the active database — `~/.localix/logs/api.log` by
 * default, the directory the desktop shell writes `desktop.log` to (`src-tauri/src/log.rs`), so
 * every process of one launch logs to one place and `bun run logs` reads them as one timeline.
 */
export function runtimeLogFile(source: Record<string, string | undefined> = process.env): string {
  return (
    envString('LOCALIX_DAEMON_LOG', source) ||
    join(dirname(resolveDbFile(source)), 'logs', 'api.log')
  )
}

/**
 * Rotate the runtime log past this size (~8 MiB), keeping one generation as
 * `<name>.old`.
 *
 * The sink was append-only with no bound. Measured on a moderately used install:
 * 3 157 entries / 567 KB over 1.44 days — **393 KB/day, ~140 MB/year**, growing
 * with usage because every request logs a `request.completed` line. Nothing ever
 * truncated it.
 *
 * The desktop shell's own log already made exactly this call for exactly this
 * reason (`src-tauri/src/log.rs`: "a menu-bar app can run for days, and the log
 * was append-only with no bound"). It caps at 1 MiB; this one is larger because
 * it is the diagnostic a user is asked for when the API misbehaves, and one
 * generation has to be long enough to still contain the incident.
 */
const MAX_LOG_BYTES = 8 * 1024 * 1024

/**
 * Bound the log at process start.
 *
 * Deliberately NOT per-write: pino writes through a raw destination stream, and
 * wrapping it to stat on every line would tax the hottest logging path to solve a
 * problem that accrues over WEEKS. Every runtime start passes through here, so
 * the realistic growth — many launches over a long-lived install — is bounded. A
 * single run that logs 8 MiB without ever restarting still overruns until it
 * does; that is the accepted edge, not an oversight.
 */
function rotateIfOversized(path: string): void {
  try {
    if (statSync(path).size <= MAX_LOG_BYTES) return
    renameSync(path, `${path}.old`)
  } catch {
    // No file yet, or a rename we are not allowed to do. Logging must never be
    // the reason a runtime fails to start.
  }
}

/** Open the runtime diagnostic sink as owner-only, including an existing file that
 * predates the privacy policy. `mode` only affects newly created files; the explicit
 * chmod is what repairs an old 0644 log before another diagnostic is appended. */
export function createRuntimeLogDestination(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  rotateIfOversized(path)
  const fd = openSync(path, 'a', 0o600)
  closeSync(fd)
  chmodSync(path, 0o600)
  return dropWritesAfterClose(
    pino.destination({ dest: path, sync: false, mkdir: false, mode: 0o600 }),
  )
}

/**
 * A line logged after shutdown closed the sink is dropped, not thrown. SonicBoom throws
 * `SonicBoom destroyed` from `write`, and pino lets it propagate into whichever caller logged —
 * a late reconcile or journal drain — where it surfaced as an uncaught error that turned a clean
 * quit into exit 1. Diagnostics must never be what crashes the runtime.
 */
function dropWritesAfterClose<T extends ReturnType<typeof pino.destination>>(destination: T): T {
  const write = destination.write.bind(destination)
  destination.write = (data: string): boolean => {
    if ((destination as { destroyed?: boolean }).destroyed) return false
    try {
      return write(data)
    } catch {
      return false
    }
  }
  return destination
}
