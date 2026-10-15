import { useEffect, type MutableRefObject, type RefObject } from 'react'
import { contentChangeAction, needsBottomScroll } from './autoScrollGeometry'
import { isUsableScrollViewport } from './chatScrollState'

interface ContentObserverOptions {
  scrollRef: RefObject<HTMLElement | null>
  shouldStickToBottomRef: MutableRefObject<boolean>
  blockedContentDirtyRef: MutableRefObject<boolean>
  autoScrollBlocked: () => boolean
  scrollToBottom: () => void
  syncPinnedState: () => void
  markProgrammaticScroll: (node: HTMLElement) => number
}

/** Keeps a pinned reader at the tail as the transcript's content child grows or is replaced. */
export function useAutoScrollContentObserver({
  scrollRef,
  shouldStickToBottomRef,
  blockedContentDirtyRef,
  autoScrollBlocked,
  scrollToBottom,
  syncPinnedState,
  markProgrammaticScroll,
}: ContentObserverOptions) {
  useEffect(() => {
    const scrollNode = scrollRef.current
    if (!scrollNode) return

    // Coalesce bursts of content changes into a single rAF tick.
    let rafId: number | null = null

    const handleContentChange = () => {
      ensureContentObserved()
      const viewport = scrollRef.current
      if (!viewport || !isUsableScrollViewport(viewport)) return

      const action = contentChangeAction(
        shouldStickToBottomRef.current,
        autoScrollBlocked(),
        rafId !== null,
      )

      // Same-frame re-pin: a ResizeObserver callback runs AFTER layout but BEFORE
      // paint, so correcting scrollTop here lands in the same frame the row's new
      // height was applied. Deferring it to the rAF below let the browser paint one
      // mispositioned frame first — which, multiplied across the dozens of row
      // measurements a virtualized list does on open, is the "chat jitters for a
      // few seconds then settles" flicker. Only while pinned + not blocked.
      if (action === 'scroll-now') {
        blockedContentDirtyRef.current = false
        const node = scrollRef.current
        if (node && isUsableScrollViewport(node)) {
          const top = markProgrammaticScroll(node)
          if (needsBottomScroll(node.scrollTop, top)) {
            node.scrollTo({ top, behavior: 'auto' })
          }
        }
        // ResizeObserver runs after layout and before paint, so this write already
        // lands in the target frame. A second rAF scroll only repeats layout work.
        return
      }

      if (action === 'none') return
      blockedContentDirtyRef.current = true
      rafId = requestAnimationFrame(() => {
        rafId = null
        const node = scrollRef.current
        if (!node || !isUsableScrollViewport(node)) return
        if (autoScrollBlocked()) return
        blockedContentDirtyRef.current = false
        if (shouldStickToBottomRef.current) {
          scrollToBottom()
        } else {
          syncPinnedState()
        }
      })
    }

    // Watch only the direct content child for SIZE changes — the virtual list
    // container whose height TanStack Virtual updates as it measures new rows.
    // Watching subtree+characterData fires on every streamed character delta,
    // creating a runaway MutationObserver → setState → re-render loop.
    const resizeObserver = new ResizeObserver(handleContentChange)
    let observedChild: Element | null = null
    const ensureContentObserved = () => {
      const child = scrollNode.firstElementChild
      if (child === observedChild) return
      if (observedChild) resizeObserver.unobserve(observedChild)
      if (child instanceof HTMLElement) {
        resizeObserver.observe(child)
        observedChild = child
      } else {
        observedChild = null
      }
    }
    ensureContentObserved()

    // MutationObserver only for direct childList — NOT subtree/characterData.
    const mutationObserver = new MutationObserver(handleContentChange)
    mutationObserver.observe(scrollNode, { childList: true })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
    // Refs are stable; dependencies mirror the original effect.
  }, [
    autoScrollBlocked,
    scrollToBottom,
    syncPinnedState,
    markProgrammaticScroll,
    blockedContentDirtyRef,
    scrollRef,
    shouldStickToBottomRef,
  ])
}
