import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

import type { ReaderTextTarget } from './model'
import { findReaderTextRange, selectionTargetWithin } from './model'
import {
  readerSelectionAnchorRect,
  readerSelectionFocusAtStart,
  readerSelectionToolbarPosition,
} from './selection'

interface UseReaderTextSelectionOptions {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  surfaceRef: RefObject<HTMLElement | null>
  contentKey: string | null
}

interface StoredSelectionRange {
  range: Range
  focusAtStart: boolean
}

interface ReaderSelectionPosition {
  left: number
  top: number
  arrowLeft: number
  placement: 'above' | 'below'
}

/**
 * Owns native text-selection capture and collision-aware toolbar placement.
 *
 * The hook deliberately exposes only the normalized quote/target and event
 * ports. Annotation persistence and workbench bindings stay outside this
 * geometry adapter.
 */
export function useReaderTextSelection({
  articleRef,
  scrollRef,
  surfaceRef,
  contentKey,
}: UseReaderTextSelectionOptions) {
  const [selectionTarget, setSelectionTarget] = useState<ReaderTextTarget | null>(null)
  const [position, setPosition] = useState<ReaderSelectionPosition | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const storedRangeRef = useRef<StoredSelectionRange | null>(null)
  const selectionTargetRef = useRef<ReaderTextTarget | null>(null)
  const selectingRef = useRef(false)
  const preserveSelectionRef = useRef(false)
  const restoringSelectionRef = useRef(false)
  const positionFrameRef = useRef(0)
  const captureFrameRef = useRef(0)

  const reposition = useCallback(() => {
    cancelAnimationFrame(positionFrameRef.current)
    positionFrameRef.current = requestAnimationFrame(() => {
      const stored = storedRangeRef.current
      const article = articleRef.current
      const scroller = scrollRef.current
      const surface = surfaceRef.current
      const toolbar = toolbarRef.current
      if (!stored || !article || !scroller || !surface || !toolbar) {
        setPosition(null)
        return
      }
      try {
        let anchor = readerSelectionAnchorRect(stored.range, scroller, stored.focusAtStart)
        if (!anchor && selectionTargetRef.current) {
          const found = findReaderTextRange(article, selectionTargetRef.current)
          const first = found?.segments[0]
          const last = found?.segments.at(-1)
          if (first && last) {
            const range = article.ownerDocument.createRange()
            range.setStart(first.node, first.start)
            range.setEnd(last.node, last.end)
            stored.range = range
            anchor = readerSelectionAnchorRect(range, scroller, stored.focusAtStart)
          }
        }
        if (!anchor) {
          setPosition(null)
          return
        }
        const next = readerSelectionToolbarPosition(
          anchor,
          surface.getBoundingClientRect(),
          toolbar.getBoundingClientRect(),
        )
        setPosition((current) =>
          current?.left === next.left &&
          current.top === next.top &&
          current.arrowLeft === next.arrowLeft &&
          current.placement === next.placement
            ? current
            : next,
        )
      } catch {
        setPosition(null)
      }
    })
  }, [articleRef, scrollRef, surfaceRef])

  /** What is held outside React about the selection: the stored range and the pending frames. */
  const forgetStoredSelection = useCallback(() => {
    cancelAnimationFrame(captureFrameRef.current)
    cancelAnimationFrame(positionFrameRef.current)
    storedRangeRef.current = null
    selectionTargetRef.current = null
    preserveSelectionRef.current = false
  }, [])

  const resetSelection = useCallback(() => {
    forgetStoredSelection()
    setSelectionTarget(null)
    setPosition(null)
  }, [forgetStoredSelection])

  // Other content is no longer what was selected: dropped in the render that shows it, so the
  // old toolbar is never drawn over the new text.
  const [shownContentKey, setShownContentKey] = useState(contentKey)
  if (shownContentKey !== contentKey) {
    setShownContentKey(contentKey)
    setSelectionTarget(null)
    setPosition(null)
  }

  const clearSelection = useCallback(() => {
    const ownerDocument = articleRef.current?.ownerDocument ?? globalThis.document
    resetSelection()
    ownerDocument?.getSelection()?.removeAllRanges()
  }, [articleRef, resetSelection])

  const restoreStoredRange = useCallback(() => {
    const article = articleRef.current
    const stored = storedRangeRef.current
    const nativeSelection = article?.ownerDocument.getSelection()
    if (!article || !stored || !nativeSelection) return false
    try {
      restoringSelectionRef.current = true
      nativeSelection.removeAllRanges()
      nativeSelection.addRange(stored.range.cloneRange())
      return true
    } catch {
      return false
    } finally {
      restoringSelectionRef.current = false
    }
  }, [articleRef])

  const captureSelection = useCallback(
    (clearWhenInvalid: boolean) => {
      const article = articleRef.current
      const ownerDocument = article?.ownerDocument
      const nativeSelection = ownerDocument?.getSelection() ?? null
      const target = selectionTargetWithin(article, nativeSelection)
      if (!target || !nativeSelection || nativeSelection.rangeCount < 1) {
        if (clearWhenInvalid) resetSelection()
        return
      }
      const liveRange = nativeSelection.getRangeAt(0)
      storedRangeRef.current = {
        range: liveRange.cloneRange(),
        focusAtStart: readerSelectionFocusAtStart(nativeSelection, liveRange),
      }
      selectionTargetRef.current = target
      setSelectionTarget((current) =>
        current?.quote === target.quote &&
        current.before === target.before &&
        current.after === target.after
          ? current
          : target,
      )
    },
    [articleRef, resetSelection],
  )

  const scheduleCapture = useCallback(
    (clearWhenInvalid: boolean) => {
      cancelAnimationFrame(captureFrameRef.current)
      captureFrameRef.current = requestAnimationFrame(() => captureSelection(clearWhenInvalid))
    },
    [captureSelection],
  )

  const onSelectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      selectingRef.current = true
      if (selectionTargetRef.current) {
        clearSelection()
      } else {
        setPosition(null)
      }
    },
    [clearSelection],
  )

  const onSelectionPointerUp = useCallback(() => {
    selectingRef.current = false
    scheduleCapture(true)
  }, [scheduleCapture])

  const onSelectionPointerCancel = useCallback(() => {
    selectingRef.current = false
    scheduleCapture(false)
  }, [scheduleCapture])

  const onSelectionKeyUp = useCallback(
    (_event: ReactKeyboardEvent<HTMLElement>) => scheduleCapture(true),
    [scheduleCapture],
  )

  // Reader HTML can be reconciled after unrelated responsive/context state
  // changes. Recompute only the floating geometry; never rewrite the native
  // selection during an ordinary render.
  useLayoutEffect(() => {
    if (selectionTargetRef.current) reposition()
  })

  useEffect(() => {
    forgetStoredSelection()
  }, [contentKey, forgetStoredSelection])

  useEffect(() => {
    const article = articleRef.current
    const scroller = scrollRef.current
    const surface = surfaceRef.current
    if (!article || !scroller || !surface) return
    const ownerDocument = article.ownerDocument
    const ownsSelectionInteraction = (target: EventTarget | null) => {
      const view = ownerDocument.defaultView
      const element = view && target instanceof view.Element ? target : null
      if (!element) return false
      return Boolean(
        toolbarRef.current?.contains(element) ||
        element.closest('[role="menu"], [role="listbox"], [data-slot="popover-content"]'),
      )
    }
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !selectionTargetRef.current) return
      if (ownsSelectionInteraction(event.target)) {
        preserveSelectionRef.current = true
        requestAnimationFrame(() => {
          preserveSelectionRef.current = false
        })
        return
      }
      if (!article.contains(event.target as Node)) clearSelection()
    }
    const onSelectionChange = () => {
      if (selectingRef.current || restoringSelectionRef.current) return
      const nativeSelection = ownerDocument.getSelection()
      const nativeRange =
        nativeSelection && nativeSelection.rangeCount > 0 ? nativeSelection.getRangeAt(0) : null
      const nativeSelectionValid = Boolean(
        nativeSelection &&
        nativeRange &&
        !nativeSelection.isCollapsed &&
        nativeSelection.toString().trim() &&
        article.contains(nativeRange.commonAncestorContainer),
      )
      if (!nativeSelectionValid && selectionTargetRef.current) {
        if (preserveSelectionRef.current || ownsSelectionInteraction(ownerDocument.activeElement)) {
          if (restoreStoredRange()) reposition()
        } else {
          resetSelection()
        }
        return
      }
      captureSelection(false)
    }
    const observer = new ResizeObserver(reposition)
    observer.observe(surface)
    observer.observe(scroller)
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    ownerDocument.addEventListener('pointerdown', onDocumentPointerDown, true)
    ownerDocument.addEventListener('selectionchange', onSelectionChange)
    scroller.addEventListener('scroll', reposition, { passive: true })
    globalThis.addEventListener('resize', reposition)
    return () => {
      observer.disconnect()
      ownerDocument.removeEventListener('pointerdown', onDocumentPointerDown, true)
      ownerDocument.removeEventListener('selectionchange', onSelectionChange)
      scroller.removeEventListener('scroll', reposition)
      globalThis.removeEventListener('resize', reposition)
    }
  }, [
    articleRef,
    captureSelection,
    clearSelection,
    contentKey,
    reposition,
    resetSelection,
    restoreStoredRange,
    scrollRef,
    selectionTarget,
    surfaceRef,
  ])

  useEffect(
    () => () => {
      cancelAnimationFrame(captureFrameRef.current)
      cancelAnimationFrame(positionFrameRef.current)
    },
    [],
  )

  const toolbarStyle: CSSProperties | undefined = position
    ? ({
        left: position.left,
        top: position.top,
        '--reader-selection-arrow-left': `${position.arrowLeft}px`,
      } as CSSProperties)
    : undefined

  return {
    selection: selectionTarget?.quote ?? '',
    selectionTarget,
    selectionToolbarRef: toolbarRef,
    selectionToolbarStyle: toolbarStyle,
    selectionToolbarPlacement: position?.placement,
    selectionToolbarVisible: position !== null,
    clearSelection,
    onSelectionPointerDown,
    onSelectionPointerUp,
    onSelectionPointerCancel,
    onSelectionKeyUp,
  }
}
