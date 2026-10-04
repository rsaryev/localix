/**
 * How long to wait before re-reading the roster.
 *
 * PURE BY CONSTRUCTION: every signal arrives in `Input`, so the same input always yields the same
 * decision and there is no clock or store read inside. That is what makes a cadence testable at
 * all — the alternative is a `setInterval` whose behaviour you can only observe by waiting for it.
 * (The shape is CodexBar's `AdaptiveRefreshPolicy`, which states the same rule for the same reason.)
 *
 * WHY ADAPTIVE RATHER THAN A FIXED TICK. A refresh walks four history roots; the index makes that
 * cheap, not free. A fixed interval therefore has no good value: fast enough to follow a running
 * delegation is wasteful for the 99% of the time nothing is running, and slow enough to be polite
 * means a live agent's transcript is stale while you watch it. So the cadence follows the one thing
 * that actually predicts change — whether anything is happening.
 */

export interface RefreshInput {
  readonly now: number
  /** A hidden roster is not stale, it is unobserved. */
  readonly visible: boolean
  /** Delegations running right now. The strongest predictor that the list is about to change. */
  readonly liveDelegations: number
  /** Most recent activity across every discovered session, when anything is known. */
  readonly lastActivityAt?: number
  /**
   * The backend's history watch is armed and this panel is subscribed to it
   * (`model/useHistoryStream.ts`): a write to any agent's history is PUSHED, so the timer is only a
   * backstop for what the watch can miss.
   */
  readonly historyPushed?: boolean
}

export interface RefreshDecision {
  /** Milliseconds until the next read, or `null` to stop refreshing entirely. */
  readonly delayMs: number | null
  /** Why this cadence — surfaced in a tooltip so an idle-looking list can explain itself. */
  readonly reason: string
}

export const REFRESH_LIVE_MS = 5_000
export const REFRESH_RECENT_MS = 20_000
export const REFRESH_WARM_MS = 60_000
export const REFRESH_COLD_MS = 5 * 60_000

/** Activity newer than this counts as "still happening" even with no live delegation attached. */
export const RECENT_ACTIVITY_MS = 5 * 60_000
/** Activity newer than this counts as "this session is warm". */
export const WARM_ACTIVITY_MS = 60 * 60_000

export function nextRefreshDelay(input: RefreshInput): RefreshDecision {
  // Not a cadence decision at all: nobody is looking, so there is nothing to keep fresh. Returning
  // a long delay instead would still wake a timer for a tab that may never be shown again.
  if (!input.visible) return { delayMs: null, reason: 'Paused while this view is hidden' }

  if (input.liveDelegations > 0) {
    return {
      delayMs: REFRESH_LIVE_MS,
      reason: `Following ${input.liveDelegations} running delegation${input.liveDelegations === 1 ? '' : 's'}`,
    }
  }

  // Past this point the cadence exists only to notice history being written. With the watch
  // pushing that, polling at "recent activity" speed re-enumerated every root every 20 s to learn
  // what a frame already said; the cold tick remains for a root created after the watch armed.
  // A running delegation above stays fast: its state is read from a screen, which has no event.
  if (input.historyPushed) return { delayMs: REFRESH_COLD_MS, reason: 'Following history changes' }

  const since = input.lastActivityAt === undefined ? undefined : input.now - input.lastActivityAt
  // An unknown last-activity is treated as cold rather than as urgent: it means nothing has been
  // read yet, and guessing "busy" would make an empty machine poll hardest.
  if (since === undefined) return { delayMs: REFRESH_COLD_MS, reason: 'No activity recorded yet' }
  if (since < 0) return { delayMs: REFRESH_RECENT_MS, reason: 'Activity is newer than this clock' }
  if (since < RECENT_ACTIVITY_MS) return { delayMs: REFRESH_RECENT_MS, reason: 'Active recently' }
  if (since < WARM_ACTIVITY_MS)
    return { delayMs: REFRESH_WARM_MS, reason: 'Active in the last hour' }
  return { delayMs: REFRESH_COLD_MS, reason: 'Quiet — checking occasionally' }
}
