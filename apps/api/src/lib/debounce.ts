/**
 * Trailing-edge debouncer: `schedule(fn)` runs `fn` after `delayMs` of quiet,
 * cancelling any pending run. The timer is `unref`'d so it never keeps the
 * process alive. Shared by callers that coalesce bursty triggers (plugin
 * channel refresh, LSP diagnostics flush).
 */
export function createDebouncer(delayMs: number): {
  schedule(fn: () => void): void
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule(fn) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        fn()
      }, delayMs)
      timer.unref?.()
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/**
 * Leading + trailing throttle: the first `schedule` after a quiet `intervalMs` runs at
 * once; calls inside the window collapse into ONE trailing run at the window's end, with
 * the latest `fn`. So a burst still costs at most one run per interval, but the first
 * fact of a burst is not held back — which is what a trailing debounce cannot give when
 * the burst's first item is the one someone is waiting to see (a syntax error's squiggle
 * arriving ahead of the slower semantic pass). Timers are `unref`'d like the debouncer's.
 */
export function createThrottle(
  intervalMs: number,
  now: () => number = Date.now,
): { schedule(fn: () => void): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => void) | null = null
  let lastRun = Number.NEGATIVE_INFINITY
  const run = (fn: () => void) => {
    lastRun = now()
    fn()
  }
  return {
    schedule(fn) {
      if (timer) {
        pending = fn
        return
      }
      const wait = lastRun + intervalMs - now()
      if (wait <= 0) {
        run(fn)
        return
      }
      pending = fn
      timer = setTimeout(() => {
        timer = null
        const next = pending
        pending = null
        if (next) run(next)
      }, wait)
      timer.unref?.()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}
