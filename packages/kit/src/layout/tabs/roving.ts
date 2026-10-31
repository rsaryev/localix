import { useRef, type KeyboardEvent } from 'react'

// Index math for an ARIA tablist: the next/previous or first/last ENABLED tab to move focus to.
// Disabled tabs are skipped; arrow stepping wraps around the ends. Typed only on `{ disabled? }`
// so the focus logic is testable without DOM.

type Disablable = { disabled?: boolean }

/** Index of the tab to focus when stepping `dir` from `start`, skipping disabled
 *  tabs and wrapping at the ends. Returns the start index when it is the only
 *  enabled tab, and -1 when the list is empty or every tab is disabled. */
function nextEnabledIndex(items: ReadonlyArray<Disablable>, start: number, dir: 1 | -1): number {
  if (items.length === 0) return -1
  for (let step = 1; step <= items.length; step++) {
    const i = (start + dir * step + items.length) % items.length
    if (!items[i].disabled) return i
  }
  return -1
}

/** First/last enabled tab — backs Home/End in the ARIA tablist keyboard pattern.
 *  Returns -1 when the list is empty or every tab is disabled. */
function edgeEnabledIndex(items: ReadonlyArray<Disablable>, edge: 'first' | 'last'): number {
  if (edge === 'first') {
    for (let i = 0; i < items.length; i++) if (!items[i].disabled) return i
  } else {
    for (let i = items.length - 1; i >= 0; i--) if (!items[i].disabled) return i
  }
  return -1
}

type RovingTab<T extends string> = { id: T; disabled?: boolean }

/** The tab an Arrow/Home/End key moves to, `-1` when none is enabled, or null for other keys. */
export function rovingTarget(
  items: ReadonlyArray<{ disabled?: boolean }>,
  index: number,
  key: string,
): number | null {
  if (key === 'Home' || key === 'End')
    return edgeEnabledIndex(items, key === 'Home' ? 'first' : 'last')
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    return nextEnabledIndex(items, index, key === 'ArrowRight' ? 1 : -1)
  }
  return null
}

/**
 * The ARIA tabs keyboard pattern shared by `TabStrip` and `TabBar`: the whole list is one Tab
 * stop (roving `tabIndex`), Arrow keys step through enabled tabs and wrap, Home/End jump to the
 * ends, and a move both activates and focuses the target.
 */
export function useRovingTabs<T extends string>(
  items: ReadonlyArray<RovingTab<T>>,
  onChange: (id: T) => void,
) {
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())

  /** Ref callback that keeps `tabRefs` keyed by tab id. */
  const registerTab = (id: T) => (node: HTMLButtonElement | null) => {
    if (node) tabRefs.current.set(id, node)
    else tabRefs.current.delete(id)
  }

  /** Handle a navigation key on the tab at `index`; other keys are left alone. */
  const navigate = (index: number, event: KeyboardEvent) => {
    const target = rovingTarget(items, index, event.key)
    if (target === null) return
    event.preventDefault()
    if (target < 0) return
    const id = items[target]!.id
    onChange(id)
    // `preventScroll`: the browser's own focus scrolling walks every scrollable ancestor (it
    // can scroll the PAGE). The activation above drives the clamped, horizontal-only reveal.
    tabRefs.current.get(id)?.focus({ preventScroll: true })
  }

  return { tabRefs, registerTab, navigate }
}
