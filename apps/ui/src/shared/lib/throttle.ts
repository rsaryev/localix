/**
 * Leading + trailing throttle. Invokes `fn` immediately on the first call, then at
 * most once per `ms`, always flushing the LAST set of args after the window so the
 * final state is never dropped. Used to coalesce per-animation-frame store writes
 * (e.g. the live file-change stream) down to a sane cadence without losing the tail.
 */
export function createTrailingThrottle<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null

  const fire = (args: T) => {
    last = Date.now()
    fn(...args)
  }

  const drain = () => {
    timer = null
    if (pending) {
      const args = pending
      pending = null
      fire(args)
    }
  }

  return {
    /** Throttled invoke — leading edge fires now, otherwise the latest args fire on the trailing edge. */
    call(...args: T): void {
      const since = Date.now() - last
      if (since >= ms) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        fire(args)
      } else {
        pending = args
        if (!timer) timer = setTimeout(drain, ms - since)
      }
    },
    /** Emit any pending trailing args right now. */
    flush(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (pending) {
        const args = pending
        pending = null
        fire(args)
      }
    },
    /** Drop any pending trailing args without emitting. */
    cancel(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}
