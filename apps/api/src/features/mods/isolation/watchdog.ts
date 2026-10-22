import type { BudgetClock } from '@localixai/claude-plugin/mods'

/**
 * How the host knows a mod's worker holds its thread (a loop with no await), on a clock tests
 * drive: it pings the worker every quarter of `hangMs`, and a worker that has not answered for
 * `hangMs` is reported to `die`, once.
 */

/** The real clock, whose timers never keep the process alive on their own. */
export const SUPERVISOR_CLOCK: BudgetClock = {
  now: () => Date.now(),
  setTimer(fire, ms) {
    const timer = setTimeout(fire, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}

export interface Watchdog {
  /** The worker answered a ping. */
  pong(): void
  stop(): void
}

export function startWatchdog(input: {
  clock: BudgetClock
  hangMs: number
  ping: () => void
  die: (reason: string) => void
}): Watchdog {
  const { clock, hangMs } = input
  const every = Math.max(5, Math.floor(hangMs / 4))
  let awaiting = false
  let pingedAt = 0
  let cancel: (() => void) | null = null

  const tick = () => {
    cancel = null
    if (awaiting) {
      if (clock.now() - pingedAt >= hangMs) return input.die(`stopped answering for ${hangMs} ms`)
    } else {
      awaiting = true
      pingedAt = clock.now()
      input.ping()
    }
    cancel = clock.setTimer(tick, every)
  }
  cancel = clock.setTimer(tick, every)

  return {
    pong: () => void (awaiting = false),
    stop() {
      cancel?.()
      cancel = null
    },
  }
}
