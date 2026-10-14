/**
 * One deferral primitive for startup work that must happen, but must not happen
 * *before the shell paints*.
 *
 * The app installs a handful of process-wide instrumentation listeners at mount.
 * Registering them is cheap; running them all in the same commit as the first
 * render is not free, and none of them can observe anything until there is a
 * painted UI to interact with. So startup is split into a blocking phase and a
 * deferred phase that runs once the browser is idle.
 *
 * `requestIdleCallback` is the preferred scheduler. It is NOT the common path
 * here: the desktop shell is a macOS WebKit webview, and WebKit shipped the API
 * far later than Chromium — so the `setTimeout` fallback is a first-class path
 * that must behave the same, not a nicety. Both paths therefore share one
 * cancel handle and one set of tests.
 */

/** The subset of the scheduling host this module uses; injectable for tests. */
export interface IdleSchedulerHost {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
  setTimeout: (callback: () => void, ms: number) => unknown
  clearTimeout: (handle: never) => void
}

export interface IdleHandle {
  /** Idempotent. After this returns, the callback will not run. */
  cancel(): void
}

/**
 * Fallback delay when `requestIdleCallback` is unavailable. Long enough to clear
 * the first paint on the WebKit shell, short enough that a deferred listener is
 * live before a human can reach a control (a mouse move plus a click is ~10x
 * this). Every gap risk documented at the call sites is measured against it.
 */
export const IDLE_FALLBACK_DELAY_MS = 50

/**
 * Upper bound on how long a real idle callback may be starved. A busy startup can
 * otherwise postpone idle work indefinitely, which for instrumentation means
 * silently observing nothing.
 */
export const IDLE_TIMEOUT_MS = 1_000

export interface RunWhenIdleOptions {
  /** Defaults to `globalThis`. */
  host?: IdleSchedulerHost
  /** Deadline for the `requestIdleCallback` path. Defaults to {@link IDLE_TIMEOUT_MS}. */
  timeout?: number
  /** Delay for the `setTimeout` path. Defaults to {@link IDLE_FALLBACK_DELAY_MS}. */
  fallbackDelayMs?: number
}

function schedulerHost(options?: RunWhenIdleOptions): IdleSchedulerHost {
  return options?.host ?? (globalThis as unknown as IdleSchedulerHost)
}

/**
 * Run `callback` once the host is idle, or after a bounded delay where the host
 * has no idle scheduler. Returns a handle whose `cancel()` guarantees the
 * callback does not run afterwards, on either path.
 */
export function runWhenIdle(callback: () => void, options?: RunWhenIdleOptions): IdleHandle {
  const host = schedulerHost(options)
  let cancelled = false
  const run = () => {
    if (cancelled) return
    cancelled = true
    callback()
  }

  // Both entry points must exist: a host that can schedule but not cancel would
  // leave `cancel()` unable to keep its promise through the handle alone.
  if (
    typeof host.requestIdleCallback === 'function' &&
    typeof host.cancelIdleCallback === 'function'
  ) {
    const handle = host.requestIdleCallback(run, {
      timeout: options?.timeout ?? IDLE_TIMEOUT_MS,
    })
    return {
      cancel() {
        if (cancelled) return
        cancelled = true
        host.cancelIdleCallback?.(handle)
      },
    }
  }

  const timer = host.setTimeout(run, options?.fallbackDelayMs ?? IDLE_FALLBACK_DELAY_MS)
  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      host.clearTimeout(timer as never)
    },
  }
}

/**
 * Stage an installer — a function that subscribes to something and returns its own
 * teardown — onto the idle phase, and hand back a single cleanup usable directly as
 * a React effect destructor.
 *
 * The returned cleanup is correct in both orders: called before the idle callback
 * fires it cancels the pending install; called after, it disposes the installed
 * subscription. This matters under StrictMode, which mounts, unmounts, and remounts
 * every effect before the first idle callback would ever run.
 */
export function installWhenIdle(
  install: () => () => void,
  options?: RunWhenIdleOptions,
): () => void {
  let dispose: (() => void) | null = null
  const handle = runWhenIdle(() => {
    dispose = install()
  }, options)
  return () => {
    handle.cancel()
    dispose?.()
    dispose = null
  }
}
