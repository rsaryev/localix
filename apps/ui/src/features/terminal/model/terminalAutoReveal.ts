// Auto-reveal policy for tab-less live PTYs. A backend PTY can outlive its grid
// tab (adopted terminals — agent jobs, dev servers — detach on tab close instead
// of dying). That's fine for a log tail, but the moment a FULL-SCREEN app takes
// the PTY over (claude, vim, an installer menu — detected server-side as an
// alternate-screen switch) an unseen terminal becomes unusable: the app is
// waiting for a human who can't see it. Policy:
//
//   - ALT-SCREEN ENTER with no open tab → reveal (adopt a tab). Edge-triggered:
//     we reveal on the false→true transition (or on first sight of an
//     already-alt PTY, e.g. right after a page reload), so a user who then
//     CLOSES the tab while the app is still full-screen is respected — no
//     re-reveal until the app leaves and re-enters the alt screen.
//   - A merely-alive tab-less shell is NOT resurfaced: command-bearing jobs
//     already have a persistent, non-stealing surface (the background-jobs
//     strip row — click to reopen), and closing an owned interactive tab kills
//     its PTY, so there is nothing silent left to indicate.
//
// Pure: callers hold the observation state (last-seen alt flag per PTY) and the
// tab lookup; this module only decides.

export interface LivePtyObservation {
  id: string
  altScreen: boolean
}

export interface AutoRevealDecision {
  /** PTY ids to adopt + reveal as terminal tabs, in observation order. */
  reveal: string[]
  /** Next observation state (replaces `prev` — ids no longer alive drop out). */
  next: Map<string, boolean>
}

/**
 * Decide which tab-less PTYs to reveal, given the previous poll's alt-screen
 * observations, the current live set, and a tab-existence lookup.
 */
export function decideAutoReveal(
  prev: ReadonlyMap<string, boolean>,
  terminals: readonly LivePtyObservation[],
  hasTab: (id: string) => boolean,
): AutoRevealDecision {
  const reveal: string[] = []
  const next = new Map<string, boolean>()
  for (const t of terminals) {
    next.set(t.id, t.altScreen)
    const rose = t.altScreen && prev.get(t.id) !== true // enter edge, or first sight while alt
    if (rose && !hasTab(t.id)) reveal.push(t.id)
  }
  return { reveal, next }
}
