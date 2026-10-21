/**
 * The provider's OWN quota window, as it reported it. Account state, never session state — two
 * sessions of the same agent share one window, so the newest reading is the current one and an older
 * session's figure says nothing about now.
 *
 * Only Codex records this. Nearly every rollout carries `rate_limits` on the `token_count` event
 * the summary walk already visits, so reading it costs no extra I/O. Claude Code transcripts carry
 * no counterpart in any usage record, which is why this is optional rather than a field every
 * provider owes.
 *
 * An account can have SEVERAL windows at once, and `primary` does not name a fixed one. Usually
 * `primary` is the weekly window and `secondary` is absent; in a reading that carries both,
 * `primary` can be a 5-HOUR window (e.g. 40%) while the weekly sits in `secondary` (e.g. 10%).
 * So a reading is identified by its LENGTH, never by the slot it arrived in — comparing a 5-hour
 * percentage against a weekly one under a single label is comparing different quantities.
 */
export interface QuotaReading {
  /** How much of the window the account has spent, as the provider computed it. */
  readonly usedPercent: number
  /** The window's length, and its IDENTITY: 300 is a 5-hour window, 10080 a weekly one. */
  readonly windowMinutes: number
  /** When the window resets, in unix ms. Past means this reading has expired — see `quotaIsCurrent`. */
  readonly resetsAt: number
  readonly planType?: string
  /** When the provider wrote the reading. */
  readonly observedAt: number
}

/**
 * A reading describes a window that ENDS. Past its reset the percentage is not merely old, it is
 * about a window that no longer exists — showing it would be a confident number for the wrong period.
 */
export function quotaIsCurrent(quota: QuotaReading, now: number): boolean {
  return quota.resetsAt > now
}

/**
 * Where a percentage stops being background and starts being a decision. Below this the figure is
 * trivia; above it, it is the answer to "can I start another agent right now", which is the question
 * an orchestrator actually has.
 */
export const QUOTA_WARN_PERCENT = 80

/**
 * How long a live delegation's screen must be unchanged before saying so is informative.
 *
 * Below this the mark appears on every healthy delegation — a screen redraws between turns — and a
 * mark a reader always sees is a mark they stop reading. Shared so the workspace and the tool cannot
 * decide it separately; the number is Symphony's own `stall_timeout_ms` default (SPEC.md:633).
 */
export const QUIET_SCREEN_MS = 5 * 60_000

/** Minutes a live screen has been still, or `undefined` when that is not worth saying. */
export function quietMinutes(lastChangeAt: number | undefined, now: number): number | undefined {
  if (lastChangeAt === undefined) return undefined
  const quiet = now - lastChangeAt
  return quiet >= QUIET_SCREEN_MS ? Math.round(quiet / 60_000) : undefined
}

/**
 * The window a caller is actually up against: the fullest one still running.
 *
 * With two windows open, the weekly can read 7% while the 5-hour one reads 45% — and the 5-hour one
 * is what stops the next agent from starting. Showing "the quota" without choosing means showing
 * whichever the provider happened to list first.
 */
export function bindingQuota(
  quotas: readonly QuotaReading[],
  now: number,
): QuotaReading | undefined {
  let binding: QuotaReading | undefined
  for (const quota of quotas) {
    if (!quotaIsCurrent(quota, now)) continue
    if (!binding || quota.usedPercent > binding.usedPercent) binding = quota
  }
  return binding
}

/** One wording for every surface, so the workspace chip and the tool never disagree by a rounding. */
export function formatQuota(quota: QuotaReading, now: number): string {
  if (!quotaIsCurrent(quota, now)) {
    return `quota window ended ${shortSpan(now - quota.resetsAt)} ago — no current reading`
  }
  const window = shortSpan(quota.windowMinutes * 60_000)
  return `${Math.round(quota.usedPercent)}% of a ${window} window · resets in ${shortSpan(quota.resetsAt - now)}`
}

/** Two units at most: a quota is read at a glance or not at all. */
function shortSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  return `${minutes}m`
}
