import { backoffMs } from '@localixai/agent/backoff'
import type { ModSource } from '../contracts'

/**
 * A mod whose VM died starts again: the first death in a while on its next event; each further
 * one within a minute waits twice as long as the last; at the third within the minute it stays
 * stopped until the plugin changes. The kit unloads nothing on a VM's death: the host it ran in is
 * dropped, and the conversation's next event builds it again without the mods that sit out.
 */

export const CRASH_RULES = { deaths: 3, windowMs: 60_000, backoffMs: 1_000 }

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`

interface Deaths {
  revision: string
  at: number[]
  heldUntil: number
  stopped?: string
}

export function createCrashes(now: () => number) {
  const deaths = new Map<string, Deaths>()
  /** What the plugin did counts while it is the revision that did it. */
  const current = (source: ModSource) => {
    const kept = deaths.get(source.plugin)
    if (kept && kept.revision !== source.revision) deaths.delete(source.plugin)
    return kept?.revision === source.revision ? kept : undefined
  }
  return {
    /** The mod's VM died: the line reported for it. */
    died(source: ModSource, reason: string): string {
      const at = now()
      const before = current(source)
      const recent = [...(before?.at ?? []).filter((one) => at - one < CRASH_RULES.windowMs), at]
      const wait =
        recent.length > 1
          ? backoffMs(recent.length - 2, {
              baseMs: CRASH_RULES.backoffMs,
              maxMs: Number.MAX_SAFE_INTEGER,
            })
          : 0
      const stays = recent.length >= CRASH_RULES.deaths
      const line = `the hooks module ${reason}; ${
        stays
          ? `it stopped ${recent.length} times within ${seconds(CRASH_RULES.windowMs)} and stays stopped until the plugin changes`
          : `it starts again on its next event${wait ? ` after ${seconds(wait)}` : ''}`
      }`
      deaths.set(source.plugin, {
        revision: source.revision,
        at: recent,
        heldUntil: at + wait,
        ...(stays ? { stopped: line } : {}),
      })
      return line
    },
    /** Whether the mod sits this load out: stopped, or waiting after a death. */
    benched(source: ModSource): boolean {
      const kept = current(source)
      return kept !== undefined && (kept.stopped !== undefined || now() < kept.heldUntil)
    },
    /** The mods stopped for good, by plugin, with why. */
    stopped: (): ReadonlyMap<string, string> =>
      new Map(
        [...deaths].flatMap(([plugin, kept]) => (kept.stopped ? [[plugin, kept.stopped]] : [])),
      ),
  }
}
