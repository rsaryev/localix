import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react'

import {
  readerPageOffsetAtFraction,
  readerPagePosition,
  readerViewportFraction,
  syncReaderPageTabStops,
  type ReaderPagePosition,
  type ReaderPaginationMode,
} from './pagination'

interface UseReaderPageLayoutOptions {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  contentKey: string | null
  layoutKey: string
  viewMode: ReaderPaginationMode
  requestedFractionRef: MutableRefObject<number | null>
  onPagePositionChange: (position: ReaderPagePosition) => void
}

/**
 * Owns the DOM-only contract for reflowed Reader pages.
 *
 * The hook deliberately knows nothing about books, persistence, API routes, or
 * agent context. Callers provide two DOM ports, a layout revision, a requested
 * relative position, and a page-counter callback.
 */
export function useReaderPageLayout({
  articleRef,
  scrollRef,
  contentKey,
  layoutKey,
  viewMode,
  requestedFractionRef,
  onPagePositionChange,
}: UseReaderPageLayoutOptions) {
  const hiddenTabIndexesRef = useRef(new Map<HTMLElement, string | null>())
  const layoutMetricsRef = useRef({ viewportExtent: 0, scrollExtent: 0 })

  const syncPageTabStops = useCallback(() => {
    const article = articleRef.current
    const scroller = scrollRef.current
    if (!article || !scroller) return
    const result = syncReaderPageTabStops(
      article,
      scroller,
      viewMode === 'page',
      hiddenTabIndexesRef.current,
    )
    if (result.activeElementHidden) scroller.focus({ preventScroll: true })
  }, [articleRef, scrollRef, viewMode])

  // Chapter HTML is reconciled through `dangerouslySetInnerHTML`, so React can
  // replace descendant nodes after state updates such as page-position changes.
  // Re-apply the layout-dependent tab contract after every committed render.
  useLayoutEffect(() => {
    syncPageTabStops()
  })

  useEffect(() => {
    const scroller = scrollRef.current
    const article = articleRef.current
    if (!scroller || !article || contentKey === null) return
    const hiddenTabIndexes = hiddenTabIndexesRef.current
    let layoutFrame = 0

    const syncLayout = () => {
      const previousMetrics = layoutMetricsRef.current
      const paginated = viewMode === 'page'
      const resizeFraction =
        paginated &&
        previousMetrics.viewportExtent > 0 &&
        previousMetrics.viewportExtent !== scroller.clientWidth
          ? readerViewportFraction(
              scroller.scrollLeft,
              previousMetrics.scrollExtent,
              previousMetrics.viewportExtent,
            )
          : null
      if (resizeFraction !== null && requestedFractionRef.current === null) {
        // ResizeObserver commonly emits a scroller and an article notification
        // before the next frame. Persist the first calculation so a later
        // callback cannot cancel its frame and lose the intended position.
        requestedFractionRef.current = resizeFraction
      }
      layoutMetricsRef.current = {
        viewportExtent: scroller.clientWidth,
        scrollExtent: scroller.scrollWidth,
      }
      scroller.style.setProperty('--reader-page-extent', `${scroller.clientWidth}px`)
      scroller.style.setProperty('--reader-page-height', `${scroller.clientHeight}px`)

      cancelAnimationFrame(layoutFrame)
      layoutFrame = requestAnimationFrame(() => {
        const requestedFraction = requestedFractionRef.current
        if (paginated && requestedFraction !== null) {
          scroller.scrollLeft = readerPageOffsetAtFraction(
            requestedFraction,
            scroller.scrollWidth,
            scroller.clientWidth,
          )
        } else if (!paginated && requestedFraction !== null) {
          scroller.scrollLeft = 0
          scroller.scrollTop =
            requestedFraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        }
        if (requestedFractionRef.current !== null) requestedFractionRef.current = null

        const offset = paginated ? scroller.scrollLeft : scroller.scrollTop
        const scrollExtent = paginated ? scroller.scrollWidth : scroller.scrollHeight
        const viewportExtent = paginated ? scroller.clientWidth : scroller.clientHeight
        onPagePositionChange(readerPagePosition(offset, scrollExtent, viewportExtent))
        syncPageTabStops()
      })
    }

    const observer = new ResizeObserver(syncLayout)
    observer.observe(scroller)
    observer.observe(article)
    const images = Array.from(article.querySelectorAll('img'))
    for (const image of images) image.addEventListener('load', syncLayout)
    const initialFrame = requestAnimationFrame(syncLayout)

    return () => {
      cancelAnimationFrame(initialFrame)
      cancelAnimationFrame(layoutFrame)
      observer.disconnect()
      for (const image of images) image.removeEventListener('load', syncLayout)
      syncReaderPageTabStops(article, scroller, false, hiddenTabIndexes)
    }
  }, [
    articleRef,
    contentKey,
    layoutKey,
    onPagePositionChange,
    requestedFractionRef,
    scrollRef,
    syncPageTabStops,
    viewMode,
  ])

  return { syncPageTabStops }
}
