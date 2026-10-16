/**
 * Editor navigation history — the Back / Forward stack ("Go Back" /
 * "Go Forward"). Every file reveal that flows through `inspector.openFile`
 * (go-to-definition, references, Problems, symbol/quick-open palettes, tree
 * clicks, tool-card links, …) records the visited location here, so the user can
 * step back through where they've been and forward again — browser-history style.
 *
 * The stack stores VISITED LOCATIONS (each reveal's destination), not pre-jump
 * cursor positions, which keeps recording to a single chokepoint and needs no
 * live cursor tracking. The pure core (`pushNav`/`backNav`/`forwardNav`) is unit
 * tested; the singleton wraps it and drives the reveal through an injected
 * revealer so this module stays free of an inspector-bus import cycle.
 */

export interface NavLocation {
  /** The chat the file was opened in. Without it, stepping back reopened the file in whichever
   *  chat was on screen — another workspace, possibly another directory. */
  sessionId: string
  path: string
  /** 1-indexed line, or undefined when the file was opened without a target line. */
  line?: number
  /** 0-based column (LSP convention), or undefined. */
  column?: number
}

export interface NavState {
  entries: NavLocation[]
  /** Index of the CURRENT location in `entries` (−1 when empty). */
  index: number
}

/** Cap on retained history so a long session can't grow the stack unbounded. */
export const MAX_NAV_ENTRIES = 50

export function emptyNav(): NavState {
  return { entries: [], index: -1 }
}

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return a.sessionId === b.sessionId && a.path === b.path && a.line === b.line
}

/**
 * Record a newly visited location. Drops any forward tail (a new jump after
 * going back forks the history, like a browser), de-dupes an immediate repeat of
 * the current location, and caps the retained length from the front.
 */
export function pushNav(state: NavState, loc: NavLocation): NavState {
  const current = state.index >= 0 ? state.entries[state.index] : undefined
  if (current && sameLocation(current, loc)) return state
  const kept = state.entries.slice(0, state.index + 1)
  kept.push(loc)
  const overflow = Math.max(0, kept.length - MAX_NAV_ENTRIES)
  const entries = overflow > 0 ? kept.slice(overflow) : kept
  return { entries, index: entries.length - 1 }
}

/** Step one location back. Returns the unchanged state + null target at the start. */
export function backNav(state: NavState): { state: NavState; target: NavLocation | null } {
  if (state.index <= 0) return { state, target: null }
  const index = state.index - 1
  return { state: { ...state, index }, target: state.entries[index] }
}

/** Step one location forward. Returns the unchanged state + null target at the end. */
export function forwardNav(state: NavState): { state: NavState; target: NavLocation | null } {
  if (state.index >= state.entries.length - 1) return { state, target: null }
  const index = state.index + 1
  return { state: { ...state, index }, target: state.entries[index] }
}

// ---- Singleton wiring -------------------------------------------------------

let nav = emptyNav()
// While a back/forward reveal is in flight the resulting `openFile` must not
// re-record (that would corrupt the stack) — this guards the record call.
let navigating = false
let revealer: ((loc: NavLocation) => void) | null = null

/** The inspector bus registers how to reveal a location (its own `openFile`). */
export function setNavRevealer(reveal: (loc: NavLocation) => void): void {
  revealer = reveal
}

/** Record a visited location (no-op while a back/forward reveal is in progress). */
export function recordNavigation(loc: NavLocation): void {
  if (navigating) return
  nav = pushNav(nav, loc)
}

function step(next: { state: NavState; target: NavLocation | null }): void {
  if (!next.target) return
  nav = next.state
  navigating = true
  try {
    revealer?.(next.target)
  } finally {
    navigating = false
  }
}

/** Go to the previous visited location ("Go Back"). */
export function navigateBack(): void {
  step(backNav(nav))
}

/** Go to the next visited location ("Go Forward"). */
export function navigateForward(): void {
  step(forwardNav(nav))
}
