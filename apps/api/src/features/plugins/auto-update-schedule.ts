/**
 * WHEN THE PLUGIN AUTO-UPDATE PASS RUNS. Claude Code runs it once per interactive session, a random
 * delay of up to ten minutes after the first message. Localix is a long-running app, so the pass
 * runs a random one to ten minutes after start (spreading the fetches of many installs) and then
 * every six hours, the cadence the mini app catalogs use. What one pass does is
 * `PluginUpdates.autoUpdatePass` (`plugin-updates.ts`).
 */
export const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

const MINUTE = 60_000

/** One minute, plus up to nine more chosen at random. */
export const firstPassDelayMs = (random: () => number = Math.random): number =>
  MINUTE + Math.floor(Math.min(Math.max(random(), 0), 1) * 9 * MINUTE)

interface Timers {
  setTimeout: (run: () => void, ms: number) => unknown
  setInterval: (run: () => void, ms: number) => unknown
  clear: (timer: unknown) => void
}

const systemTimers: Timers = {
  setTimeout: (run, ms) => {
    const timer = setTimeout(run, ms)
    timer.unref?.()
    return timer
  },
  setInterval: (run, ms) => {
    const timer = setInterval(run, ms)
    timer.unref?.()
    return timer
  },
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}

/** Arm the pass; the returned function disarms it. A failing pass waits for the next one. */
export function armPluginAutoUpdate(opts: {
  run: () => Promise<unknown>
  random?: () => number
  timers?: Timers
}): () => void {
  const timers = opts.timers ?? systemTimers
  let interval: unknown = null
  const pass = () => void opts.run().catch(() => {})
  const first = timers.setTimeout(() => {
    pass()
    interval = timers.setInterval(pass, AUTO_UPDATE_INTERVAL_MS)
  }, firstPassDelayMs(opts.random))
  return () => {
    timers.clear(first)
    if (interval !== null) timers.clear(interval)
  }
}
