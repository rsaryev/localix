import type { PreviewEntry } from './preview'
import { browserEngine } from './browserUrl'

/**
 * NATIVE PAGES AN AGENT LEFT BEHIND, and when they go.
 *
 * A run that ends normally keeps the tabs its agent opened — the person may want to look at what
 * the agent saw — and an off-screen tab gives up its renderer (`releaseBackgroundPreviews`). Two
 * cases slipped past that. A run that FAILED never got to close the page it was driving. And a tab
 * still mounted in a panel the person is not looking at keeps its renderer, because the panel
 * shows it again by framing it: a hidden Google Flights page left that way (LOCALIX-108,
 * 2026-10-20) ran for half an hour and grew to 3 GB.
 *
 * The rule, for an agent-opened native page (never one the person opened) that is not on screen:
 *   - its run failed → the tab closes at once, as the agent's own `close` would have;
 *   - nothing has driven it for {@link AGENT_PAGE_IDLE_MS} and its session is not running → it
 *     closes too. The visit stays in History; the agent reopens it when it needs it again.
 * A page on screen is the person's to close, whoever opened it.
 */

/** How long an off-screen agent page may sit undriven before it is closed. */
export const AGENT_PAGE_IDLE_MS = 10 * 60_000

/** When an agent last opened or drove each page (by tab ID). */
const lastActivity = new Map<string, number>()

/** An agent opened or commanded this page now. */
export function noteAgentActivity(previewId: string, at = Date.now()): void {
  lastActivity.set(previewId, at)
}

export function forgetAgentActivity(previewIds: readonly string[]): void {
  for (const id of previewIds) lastActivity.delete(id)
}

/** Test seam. */
export function resetAgentActivity(): void {
  lastActivity.clear()
}

/** An agent's page, run in a native view: what this cleanup may close. */
const agentNativePage = (entry: PreviewEntry, desktop?: boolean) =>
  browserEngine(entry, desktop) === 'native' && !entry.userOpened && !!entry.originSessionId

export interface LeftBehindInput {
  entries: readonly PreviewEntry[]
  /** Whether the page's box is on screen now. */
  onScreen: (previewId: string) => boolean
  /** Test seam: whether native pages exist (the desktop app). */
  desktop?: boolean
}

/** The pages a FAILED run of `sessionId` opened and left off screen. */
export function leftByFailedRun(input: LeftBehindInput & { sessionId: string }): string[] {
  return input.entries
    .filter(
      (entry) =>
        agentNativePage(entry, input.desktop) &&
        entry.originSessionId === input.sessionId &&
        !input.onScreen(entry.previewId),
    )
    .map((entry) => entry.previewId)
}

/**
 * The off-screen agent pages nothing has driven for `idleMs`. A page never seen driven (restored
 * at launch) starts its clock at the first look, so a launch never closes everything at once.
 */
export function leftIdle(
  input: LeftBehindInput & {
    now: number
    running: (sessionId: string) => boolean
    idleMs?: number
  },
): string[] {
  const idleMs = input.idleMs ?? AGENT_PAGE_IDLE_MS
  return input.entries
    .filter((entry) => {
      if (!agentNativePage(entry, input.desktop) || input.running(entry.originSessionId!))
        return false
      if (input.onScreen(entry.previewId)) {
        // Looked at counts as use: the clock starts again when it leaves the screen.
        lastActivity.set(entry.previewId, input.now)
        return false
      }
      const since = lastActivity.get(entry.previewId)
      if (since === undefined) {
        lastActivity.set(entry.previewId, input.now)
        return false
      }
      return input.now - since >= idleMs
    })
    .map((entry) => entry.previewId)
}

/**
 * Whether a native page's box is on screen: laid out, with some of it inside the window. A
 * background host sits far off to the left, and a tab in an inactive panel has no box at all.
 */
export function nativePageOnScreen(previewId: string, doc: Document = document): boolean {
  const view = doc.defaultView
  for (const box of Array.from(doc.querySelectorAll<HTMLElement>('[data-native-page-id]'))) {
    if (box.dataset.nativePageId !== previewId) continue
    const rect = box.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || !view) continue
    if (
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < view.innerWidth &&
      rect.top < view.innerHeight
    )
      return true
  }
  return false
}
