/**
 * A hook's time limit counts its own time only: the clock stops while the hook waits on `next`
 * (the rest of the chain, the host's own work) or on a mods API call, and starts again when the
 * last of those settles.
 */

export interface BudgetClock {
  now(): number
  setTimer(fire: () => void, ms: number): () => void
}

export const SYSTEM_CLOCK: BudgetClock = {
  now: () => Date.now(),
  setTimer(fire, ms) {
    const timer = setTimeout(fire, ms)
    return () => clearTimeout(timer)
  },
}

export class HookTimeout extends Error {}

/** Wraps what the clock must not count: it stops until `inner` settles. */
export type Pause = <T>(inner: PromiseLike<T>) => Promise<T>

/** One hook run's clock, as its `next` and its `$` see it. */
export interface Meter {
  pause: Pause
  /** What is left of the budget now. */
  remainingMs(): number
}

/** Run `work` within `ms` of its own time; `meter.pause` wraps what the clock must not count. */
export function createBudget(clock: BudgetClock) {
  return function timed(ms: number, work: (meter: Meter) => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let remaining = ms
      let started = clock.now()
      let cancel: (() => void) | null = null
      // Waits in flight: concurrent `$` calls stop the clock once and restart it once.
      let waits = 0
      // Once the run settled (or ran out), a late call from it — a timer, a stashed `$` — is free.
      let settled = false
      const arm = () => {
        started = clock.now()
        cancel = clock.setTimer(
          () => {
            settled = true
            reject(new HookTimeout())
          },
          Math.max(0, remaining),
        )
      }
      const meter: Meter = {
        async pause<T>(inner: PromiseLike<T>): Promise<T> {
          if (settled) return await inner
          if (waits++ === 0) {
            cancel?.()
            cancel = null
            remaining -= clock.now() - started
          }
          try {
            return await inner
          } finally {
            if (--waits === 0 && !settled) arm()
          }
        },
        remainingMs: () => Math.max(0, cancel ? remaining - (clock.now() - started) : remaining),
      }
      arm()
      Promise.resolve()
        .then(() => work(meter))
        .then(resolve, reject)
        .finally(() => {
          settled = true
          cancel?.()
          cancel = null
        })
    })
  }
}
