// Pure keyboard-navigation index math for an ARIA tablist (TabStrip): given the
// tab list and a starting index, find the next/previous or first/last ENABLED tab
// to move focus to. Disabled tabs are skipped; arrow stepping wraps around the
// ends. Kept apart from tabs.tsx — and typed only on `{ disabled? }` rather than
// the full tab shape — so the focus logic is agnostic + unit-testable without DOM.

type Disablable = { disabled?: boolean }

/** Index of the tab to focus when stepping `dir` from `start`, skipping disabled
 *  tabs and wrapping at the ends. Returns the start index when it is the only
 *  enabled tab, and -1 when the list is empty or every tab is disabled. */
export function nextEnabledIndex(
  items: ReadonlyArray<Disablable>,
  start: number,
  dir: 1 | -1,
): number {
  if (items.length === 0) return -1
  for (let step = 1; step <= items.length; step++) {
    const i = (start + dir * step + items.length) % items.length
    if (!items[i].disabled) return i
  }
  return -1
}

/** First/last enabled tab — backs Home/End in the ARIA tablist keyboard pattern.
 *  Returns -1 when the list is empty or every tab is disabled. */
export function edgeEnabledIndex(items: ReadonlyArray<Disablable>, edge: 'first' | 'last'): number {
  if (edge === 'first') {
    for (let i = 0; i < items.length; i++) if (!items[i].disabled) return i
  } else {
    for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i
  }
  return -1
}
