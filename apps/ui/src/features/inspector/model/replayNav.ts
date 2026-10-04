// Pure checkpoint-browsing math for the Snapshot (message replay) tab: given the
// ordered ids of the session's tool-bearing messages and which one is focused,
// derive the 1-based position and the prev/next neighbours to step to. Kept pure
// (no store/React) so it is unit-testable and the tab stays thin.

export interface ReplayNav {
  /** 1-based position of the focused message among tool-bearing ones; 0 if none. */
  position: number
  /** Count of tool-bearing messages in the session. */
  total: number
  /** Earlier (up) tool-bearing message id, or null at the start. */
  prevId: string | null
  /** Later (down) tool-bearing message id, or null at the end. */
  nextId: string | null
}

export function computeReplayNav(ids: readonly string[], currentId: string | null): ReplayNav {
  const total = ids.length
  const index = currentId ? ids.indexOf(currentId) : -1
  return {
    position: index < 0 ? 0 : index + 1,
    total,
    prevId: index > 0 ? ids[index - 1]! : null,
    nextId: index >= 0 && index < total - 1 ? ids[index + 1]! : null,
  }
}
