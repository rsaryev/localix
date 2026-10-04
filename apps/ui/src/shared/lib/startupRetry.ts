import { runtimeReadyBarrier } from './runtimeReady'

// Startup reads target a local sidecar that normally becomes ready within a few
// seconds. Retry densely in that window, then settle into a low-cost cadence for
// a genuinely unavailable service.
const STARTUP_RETRY_DELAYS_MS = [100, 200, 400, 800, 1_000, 2_000, 5_000, 10_000] as const

export function startupRetryDelay(failureIndex: number): number {
  return STARTUP_RETRY_DELAYS_MS[
    Math.min(Math.max(0, failureIndex), STARTUP_RETRY_DELAYS_MS.length - 1)
  ]!
}

export type StartupRetryTimer = ReturnType<typeof setTimeout>
export type StartupRetrySchedule = (run: () => void, delayMs: number) => StartupRetryTimer
export type StartupRetryCancel = (timer: StartupRetryTimer) => void
export const STARTUP_FEEDBACK_FAILURE_INDEX = 3

/** Receiver-safe browser timer ports; never pass a detached Window method. */
export const scheduleStartupRetry: StartupRetrySchedule = (run, delayMs) =>
  globalThis.setTimeout(run, delayMs)
export const cancelStartupRetry: StartupRetryCancel = (timer) => globalThis.clearTimeout(timer)

/** Keep the first dense retries inside the existing loading state instead of flashing an error. */
export function shouldSurfaceStartupFailure(failureIndex: number): boolean {
  return failureIndex >= STARTUP_FEEDBACK_FAILURE_INDEX
}

/**
 * Re-run a fallible sidecar bootstrap read until it establishes authoritative state.
 *
 * The loader reports `true` only after a complete, usable response. Rejections are
 * treated like `false` defensively: a caller forgetting its own catch must not turn a
 * routine webview-before-sidecar race back into a permanent empty UI. The cleanup keeps
 * React StrictMode remounts and route teardown from leaving timers behind.
 */
export function startStartupRetry(
  load: (failureIndex: number) => Promise<boolean>,
  schedule: StartupRetrySchedule = scheduleStartupRetry,
  cancel: StartupRetryCancel = cancelStartupRetry,
): () => void {
  let stopped = false
  let failureIndex = 0
  let timer: StartupRetryTimer | null = null

  const run = async () => {
    // Hold the FIRST attempt until the API is listening: the desktop shell says so
    // when packaged, the API's own `/health` answers in a dev build. `null`
    // (production browser tab, already settled) keeps this an allocation-free,
    // tick-free fast path, so the retry cadence below is unchanged everywhere the
    // barrier does not apply.
    const barrier = runtimeReadyBarrier()
    if (barrier) await barrier
    if (stopped) return
    let synced = false
    try {
      synced = await load(failureIndex)
    } catch {
      synced = false
    }
    if (stopped || synced) return
    const delay = startupRetryDelay(failureIndex++)
    timer = schedule(() => void run(), delay)
  }

  void run()
  return () => {
    stopped = true
    if (timer !== null) cancel(timer)
  }
}
