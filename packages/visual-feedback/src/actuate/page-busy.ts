/**
 * "Page still loading": whether the page itself says it is not done. A document still parsing,
 * a request of its own in flight, or a visible busy main region / indeterminate progress bar. Images, videos and
 * ad frames still loading into a parsed page are not content a person waits for, and words such
 * as "Loading…" are left out: that guess mislabels pages.
 */
import type { VfCommandResult } from '../protocol/index'

// The page's own word that it is not done: its main region busy, or a bar that measures nothing.
// A measured bar (a player, an upload, a wizard step) or a busy widget (a refreshing list) is
// content on a finished page.
const BUSY_SELECTOR = [
  'body[aria-busy="true"]',
  'main[aria-busy="true"]',
  '[role="main"][aria-busy="true"]',
  'progress:not([value])',
  '[role="progressbar"]:not([aria-valuenow])',
].join(',')

function shown(el: Element): boolean {
  if (el.closest('[hidden],[aria-hidden="true"]')) return false
  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const r = el.getBoundingClientRect()
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.top < innerHeight &&
    r.right > 0 &&
    r.left < innerWidth
  )
}

export function isPageBusy(activity: { pending: () => boolean }): boolean {
  if (document.readyState === 'loading' || activity.pending()) return true
  return [...document.querySelectorAll(BUSY_SELECTOR)].some(shown)
}

/** Mark a result `busy` only when the page is; a settled page carries nothing. */
export function attachBusy(
  result: VfCommandResult | undefined,
  busy: boolean,
): VfCommandResult | undefined {
  return result && busy ? { ...result, busy: true } : result
}
