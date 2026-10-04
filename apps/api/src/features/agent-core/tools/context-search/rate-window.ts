/**
 * A rolling-window call counter — the flood-guard primitive for a tool that can be
 * spammed one-call-at-a-time when it should be batched. One instance per tool
 * BUILD, and tools are built per run/registry, so the window is per-agent by
 * construction: a fan-out of ten delegated workers gets ten independent windows, and
 * one spamming agent can never trip a guard for its siblings.
 */
export interface RateWindow {
  /** Record one call and return how many calls the window now holds. */
  record(now?: number): number
}

export function createRateWindow(windowMs: number): RateWindow {
  const stamps: number[] = []
  return {
    record(now = Date.now()): number {
      const cutoff = now - windowMs
      while (stamps.length > 0 && stamps[0] <= cutoff) stamps.shift()
      stamps.push(now)
      return stamps.length
    },
  }
}
