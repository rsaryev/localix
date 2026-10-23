/**
 * The ONE scroll container the Changes trees virtualize against.
 *
 * The panel scrolls as a whole — Merge / Staged / Changes sections (or one group
 * per repo), then PRs, branches and stashes — so a tree cannot own a scrollbar
 * without nesting scroll regions. Each tree therefore virtualizes against this
 * shared element, with its own distance from the top of the scrolled content as
 * the virtualizer's `scrollMargin`. Rendering the scroll element through this
 * component is what makes the context impossible to forget: a tree outside it
 * would have no viewport to window against.
 */
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'

const ScrollRootContext = createContext<HTMLElement | null>(null)

/** The shared scroll element, or null before it mounts. */
export function useChangesScrollRoot(): HTMLElement | null {
  return useContext(ScrollRootContext)
}

export function ChangesScrollArea({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setRoot} className={className} data-changes-scroll-root="">
      <ScrollRootContext.Provider value={root}>{children}</ScrollRootContext.Provider>
    </div>
  )
}

/**
 * `el`'s distance from the top of `scrollEl`'s scrolled content, kept current.
 *
 * A tree moves whenever anything above it changes height — a section above
 * collapsing, a repo group above expanding, the Staged tree above the Changes
 * tree gaining a row — and none of that re-renders the tree. A stale margin
 * windows the wrong rows: the viewport shows rows that were never mounted. Every
 * such change resizes some DIRECT child of the scroll content (the sibling above,
 * or the child that contains both), so observing those children catches all of
 * them without the tree knowing its neighbours.
 */
export function useOffsetWithin(scrollEl: HTMLElement | null, el: HTMLElement | null): number {
  const [offset, setOffset] = useState(0)
  useLayoutEffect(() => {
    if (!scrollEl || !el) return
    const measure = () => {
      const next =
        el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
      setOffset((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const resizes = new ResizeObserver(measure)
    const observeChildren = () => {
      resizes.disconnect()
      for (const child of Array.from(scrollEl.children)) resizes.observe(child)
    }
    observeChildren()
    const mutations = new MutationObserver(() => {
      observeChildren()
      measure()
    })
    mutations.observe(scrollEl, { childList: true })
    return () => {
      resizes.disconnect()
      mutations.disconnect()
    }
  }, [scrollEl, el])
  return offset
}
