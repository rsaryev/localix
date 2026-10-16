import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { envString } from './lib/env'
import { awaitPidGone } from './lib/process-liveness'
import { isRuntimeEndpointLive, type RuntimeEndpoint } from './lib/runtime-endpoint'
import { runtimeLogFile } from './lib/runtime-log-destination'
import { startupDiag } from './lib/startup-diagnostics'

/** Process-level runtime handling for the API entry: spawning, stopping, and identifying daemons. */

export async function spawnDetachedDaemon(
  entry: string,
  childArg: string,
  watch: boolean,
  host: string,
  port: number,
): Promise<void> {
  const logFile = runtimeLogFile()
  mkdirSync(dirname(logFile), { recursive: true })
  const logFd = openSync(logFile, 'a', 0o600)
  try {
    const child = spawn(process.execPath, [...(watch ? ['--watch'] : []), entry, childArg], {
      detached: true,
      // A detached console-subsystem child (Bun) gets a NEW console on Windows, which
      // flashed a terminal window on every `localix` CLI start of the daemon.
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        PORT: String(port),
        HOST: host,
        NODE_ENV: envString('NODE_ENV') || 'production',
        LOCALIX_RUNTIME_WATCH: watch ? '1' : '0',
      },
    })
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn)
      child.once('error', rejectSpawn)
    })
    child.unref()
  } finally {
    closeSync(logFd)
  }
}

export function endpointPort(endpoint: RuntimeEndpoint | null): number | undefined {
  if (!endpoint) return undefined
  const port = Number(new URL(endpoint.baseUrl).port)
  return Number.isInteger(port) && port > 0 ? port : undefined
}

/**
 * How long a runtime we asked to stop gets before it is killed outright.
 *
 * This used to be fifteen seconds with no escalation, and that number does not fit
 * anywhere: the desktop shell gives a whole start attempt twelve, so a predecessor
 * taking its full grace guaranteed the successor was killed for being slow — while the
 * predecessor was merely being patient with. Five seconds, then SIGKILL, keeps the whole
 * handover inside one start attempt.
 */
const STOP_RUNTIME_GRACE_MS = 5_000
const STOP_RUNTIME_KILL_GRACE_MS = 500

export async function stopRuntime(endpoint: RuntimeEndpoint): Promise<void> {
  if (!(await isRuntimeEndpointLive(endpoint))) return
  startupDiag(`stopping the incompatible runtime at ${endpoint.baseUrl} (pid ${endpoint.pid})`)
  try {
    process.kill(endpoint.pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  if (await awaitPidGone(endpoint.pid, STOP_RUNTIME_GRACE_MS, 50)) return
  startupDiag(`pid ${endpoint.pid} ignored SIGTERM; killing it`)
  try {
    process.kill(endpoint.pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    throw error
  }
  if (await awaitPidGone(endpoint.pid, STOP_RUNTIME_KILL_GRACE_MS, 50)) return
  throw new Error(`Localix API pid ${endpoint.pid} survived SIGKILL.`)
}

/**
 * A descriptor bearing OUR pid is this process's own past, never a runtime to attach to or stop.
 *
 * `bun --watch` re-evaluates the entry inside the SAME process. The reloaded module then finds a
 * pid that is alive — us — and a `/health` that still answers for a beat, because the outgoing
 * server has not finished closing. It attached to that endpoint (`owned: false`, `stop()` a no-op),
 * started no server of its own, and moments later the outgoing one was gone: process up, port
 * empty, nothing logged, only a full restart recovering it. That is the reported dev symptom.
 *
 * `stopRuntime` on the same descriptor is the other half — it SIGTERMs us and then waits fifteen
 * seconds for ourselves to die.
 *
 * Asked HERE rather than inside `discoverRuntimeEndpoint`, because that helper also answers "wait
 * until the runtime is up" for callers legitimately waiting on their own process.
 */
export function isOwnDescriptor(endpoint: RuntimeEndpoint | null): boolean {
  return endpoint?.pid === process.pid
}
