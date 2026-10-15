/** Reconnect attempts allowed before a dropped stream is reported as dead. */
export const MAX_RECONNECT_ATTEMPTS = 6

/** Bounded exponential backoff for the `attempt`-th (0-based) reattach: 250 ms doubling to 4 s. */
export function reconnectDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 4_000)
}

export interface PtyCloseFacts {
  owned: boolean
  receiving: boolean
  pending: boolean
  unaccepted: boolean
  departed: boolean
  /** Another grid item still shows this terminal. */
  stillListed: boolean
}

/**
 * Kill the PTY ONLY when the user actually closed this tab (the WorkItem is gone from the grid)
 * and this pane owned it. A hidden/warm/reload unmount or a transfer keeps the PTY alive.
 */
export function shouldClosePty(facts: PtyCloseFacts): boolean {
  return (
    facts.owned &&
    !facts.receiving &&
    !facts.pending &&
    !facts.unaccepted &&
    !facts.stillListed &&
    !facts.departed
  )
}
