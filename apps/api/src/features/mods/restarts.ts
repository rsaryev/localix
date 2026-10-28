import type { BudgetClock } from '@localixai/claude-plugin/mods'
import { backoffMs } from '@localixai/agent/backoff'

/**
 * Which plugins' mods may start, and why one may not. A mod that did not load is failed until the
 * plugin changes. A mod whose VM died starts again: the first death in a while on its next
 * event; each further one within `windowMs` waits twice as long as the last (from `backoffMs`);
 * at `deaths` within the window the mod is failed too. Each death and failure is reported once.
 */

export interface RestartRules {
  deaths: number
  windowMs: number
  backoffMs: number
}

export const RESTART_RULES: RestartRules = { deaths: 3, windowMs: 60_000, backoffMs: 1_000 }

/** The real clock, whose timers never keep the process alive on their own. */
export const SUPERVISOR_CLOCK: BudgetClock = {
  now: () => Date.now(),
  setTimer(fire, ms) {
    const timer = setTimeout(fire, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}

export function createModHealth(
  rules: RestartRules,
  now: () => number,
  report: (plugin: string, message: string) => void,
) {
  const failures = new Map<string, string>()
  /** Plugins failed by the death limit, which only a change to the plugin lifts. */
  const exhausted = new Set<string>()
  const deaths = new Map<string, number[]>()
  const heldUntil = new Map<string, number>()

  const health = {
    /** Why each failed plugin's mod does not run, by plugin. */
    failures: failures as ReadonlyMap<string, string>,
    /** The mod did not load: reported, and not started again until the plugin changes. */
    fail(plugin: string, why: string) {
      failures.set(plugin, why)
      report(plugin, `the hooks module did not load: ${why}`)
    },
    /** A running instance's VM died: answers true when the mod stays stopped. */
    died(plugin: string, reason: string): boolean {
      const at = now()
      const recent = (deaths.get(plugin) ?? []).filter((one) => at - one < rules.windowMs)
      recent.push(at)
      deaths.set(plugin, recent)
      const wait =
        recent.length > 1
          ? backoffMs(recent.length - 2, {
              baseMs: rules.backoffMs,
              maxMs: Number.MAX_SAFE_INTEGER,
            })
          : 0
      const stays = recent.length >= rules.deaths
      const message = `the hooks module ${reason}; ${
        stays
          ? `it stopped ${recent.length} times within ${seconds(rules.windowMs)} and stays stopped until the plugin changes`
          : `it starts again on its next event${wait ? ` after ${seconds(wait)}` : ''}`
      }`
      report(plugin, message)
      if (stays) {
        failures.set(plugin, message)
        exhausted.add(plugin)
      } else heldUntil.set(plugin, at + wait)
      return stays
    },
    /** False while the plugin's mod is failed, or waits after a death. */
    mayStart: (plugin: string) =>
      !failures.has(plugin) && now() >= (heldUntil.get(plugin) ?? -Infinity),
    /**
     * An instance started: a load failure is lifted. One that reached the death limit is not: a
     * start that was already under way when it did must not restart a crash-looping mod.
     */
    started(plugin: string) {
      if (!exhausted.has(plugin)) failures.delete(plugin)
    },
    /** The plugin changed or went: what it did so far counts no more. */
    forget(plugin: string) {
      failures.delete(plugin)
      exhausted.delete(plugin)
      deaths.delete(plugin)
      heldUntil.delete(plugin)
    },
    /** Only `plugins` are wanted: the failures of the rest go. */
    keep(plugins: ReadonlyMap<string, unknown>) {
      for (const plugin of Array.from(failures.keys()))
        if (!plugins.has(plugin)) health.forget(plugin)
    },
  }
  return health
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`
