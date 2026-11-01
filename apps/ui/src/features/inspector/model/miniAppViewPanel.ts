import { isTabOpenedAs } from '@/entities/workspace-grid/model'

const PANEL_TIMEOUT_MS = 6_000
const QUIET_MS = 300
const SETTLE_CAP_MS = 4_000

/**
 * The panel of the tab opened as `id` that is on screen. A mini app's session tab carries its
 * session in its id (`tabIdInScope`), and only the active session's is visible — so the visible
 * one is the view in front of the person, never another chat's hidden copy.
 */
export function visiblePanel(id: string, chat?: string): HTMLElement | null {
  const selector = `[data-slot="tab-panel"][data-work-item-id^="${CSS.escape(id)}"]`
  // For a per-chat view only THIS chat's tab counts (or the unqualified one, which is no other
  // chat's); "opened as" alone also matches `<id>@<any chat>`.
  const ours = (tabId: string) =>
    chat === undefined ? isTabOpenedAs(tabId, id) : tabId === id || tabId === `${id}@${chat}`
  for (const panel of document.querySelectorAll<HTMLElement>(selector)) {
    if (!ours(panel.dataset.workItemId ?? '')) continue
    const box = panel.getBoundingClientRect()
    if (!panel.hidden && box.width > 0 && box.height > 0) return panel
  }
  return null
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function waitForPanel(id: string, chat?: string): Promise<HTMLElement | null> {
  const deadline = performance.now() + PANEL_TIMEOUT_MS
  for (;;) {
    const panel = visiblePanel(id, chat)
    if (panel || performance.now() > deadline) return panel
    await delay(50)
  }
}

/**
 * Resolve once the panel's STRUCTURE has gone QUIET_MS without a change, or at the cap. A view
 * that just opened is a loading hint, then its first render, then its first poll's answer; a
 * command run in the middle of that reads a page that is about to change under it.
 *
 * Only elements arriving and leaving count. A view that shows time changes its text and its
 * progress bar's width many times a second, forever: counting those, a snapshot of a
 * running timer waited out the whole cap on every call.
 */
export function settle(panel: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const timers: { quiet?: ReturnType<typeof setTimeout>; cap?: ReturnType<typeof setTimeout> } =
      {}
    const observer = new MutationObserver(() => {
      clearTimeout(timers.quiet)
      timers.quiet = setTimeout(done, QUIET_MS)
    })
    function done() {
      observer.disconnect()
      clearTimeout(timers.quiet)
      clearTimeout(timers.cap)
      resolve()
    }
    observer.observe(panel, { subtree: true, childList: true })
    timers.quiet = setTimeout(done, QUIET_MS)
    timers.cap = setTimeout(done, SETTLE_CAP_MS)
  })
}
