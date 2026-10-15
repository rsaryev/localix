import { useRef, type KeyboardEvent } from 'react'
import { edgeEnabledIndex, nextEnabledIndex } from './keyboard'

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
