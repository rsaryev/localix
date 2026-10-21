// Pure shell-style history navigation for the composer — the index/draft stepping
// behind usePromptHistory's ArrowUp/ArrowDown, split out so the boundary math is
// unit-testable without a hook. `prompts` is ordered oldest→newest; within a step
// index 0 = newest, index n-1 = oldest, -1 = idle (not navigating).

export interface HistoryNav {
  /** -1 = not navigating; otherwise steps back from the newest (0 = newest). */
  index: number
  /** Live draft stashed on the first ArrowUp, restored on ArrowDown past newest. */
  draft: string
}

export const IDLE_NAV: HistoryNav = { index: -1, draft: '' }

export interface NavStep {
  /** Navigation state after the step (unchanged for a no-op / clamp). */
  nav: HistoryNav
  /** Text to place in the composer, or null when the step is a no-op. */
  value: string | null
}

/** ArrowUp — recall an OLDER prompt. On the first step stash `current` as the draft
 *  (so ArrowDown past the newest restores it); clamp (stay) once at the oldest. */
export function stepOlder(prompts: string[], nav: HistoryNav, current: string): NavStep {
  const n = prompts.length
  if (n === 0) return { nav, value: null }
  if (nav.index === -1) {
    return { nav: { index: 0, draft: current }, value: prompts[n - 1] ?? null }
  }
  if (nav.index < n - 1) {
    const index = nav.index + 1
    return { nav: { index, draft: nav.draft }, value: prompts[n - 1 - index] ?? null }
  }
  return { nav, value: prompts[0] ?? null } // already at the oldest — stay
}

/** ArrowDown — recall a NEWER prompt; past the newest, restore the stashed draft and
 *  return to idle. No-op when not navigating. */
export function stepNewer(prompts: string[], nav: HistoryNav): NavStep {
  if (nav.index <= -1) return { nav, value: null }
  if (nav.index === 0) return { nav: { index: -1, draft: nav.draft }, value: nav.draft }
  const index = nav.index - 1
  return { nav: { index, draft: nav.draft }, value: prompts[prompts.length - 1 - index] ?? null }
}
