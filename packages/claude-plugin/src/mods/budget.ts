/**
 * A hook's time limit counts its own time only: the clock stops while the hook waits on `next`
 * (the rest of the chain, the host's own work) and starts again when that settles.
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

/** Run `work` within `ms` of its own time; `pause` wraps what the clock must not count. */
export function createBudget(clock: BudgetClock) {
  return function timed(
    ms: number,
    work: (pause: <T>(inner: Promise<T>) => Promise<T>) => unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let remaining = ms
      let started = clock.now()
      let cancel: (() => void) | null = null
      const arm = () => {
        started = clock.now()
        cancel = clock.setTimer(() => reject(new HookTimeout()), Math.max(0, remaining))
      }
      const pause = async <T>(inner: Promise<T>): Promise<T> => {
        cancel?.()
        cancel = null
        remaining -= clock.now() - started
        try {
          return await inner
        } finally {
          arm()
        }
      }
      arm()
      Promise.resolve()
        .then(() => work(pause))
        .then(resolve, reject)
        .finally(() => cancel?.())
    })
  }
}
