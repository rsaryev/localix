import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { ReaderDocument } from '../shared/contracts'
import {
  emptyReaderNavigationTrail,
  moveReaderNavigation,
  pushReaderNavigation,
  readerFragmentTarget,
  type ReaderNavigationLocation,
  type ReaderPreferences,
  type ReaderTextTarget,
} from './model'
import { readerPagePosition, readerViewportFraction } from './pagination'
import { readerScrollAxis, seatReaderScroller } from './readerPaneModel'
import { readerMotionSafeScrollBehavior } from './readerSources'
import type { ReaderPendingFragment } from './useReaderTargetReveal'

/** Page and chapter turns, plus the back/forward trail of deliberate jumps. */
export function useReaderNavigation({
  scrollRef,
  articleRef,
  document,
  sourceKey,
  chapterIndex,
  setChapterIndex,
  loadedChapterIndex,
  scrollFraction,
  viewMode,
  revealReaderTarget,
  setHighlightTarget,
  setPendingFragment,
  pendingChapterFractionRef,
  exactNavigationRef,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  articleRef: RefObject<HTMLElement | null>
  document: ReaderDocument | null
  sourceKey: string
  chapterIndex: number
  setChapterIndex: Dispatch<SetStateAction<number>>
  loadedChapterIndex: number
  scrollFraction: number
  viewMode: ReaderPreferences['viewMode']
  revealReaderTarget: (target: HTMLElement, block?: ScrollLogicalPosition) => void
  setHighlightTarget: Dispatch<SetStateAction<ReaderTextTarget | null>>
  setPendingFragment: Dispatch<SetStateAction<ReaderPendingFragment | null>>
  pendingChapterFractionRef: RefObject<number | null>
  exactNavigationRef: RefObject<ReaderPendingFragment | null>
}) {
  const [navigationTrail, setNavigationTrail] = useState(emptyReaderNavigationTrail)

  const turnReadingPosition = useCallback(
    (direction: -1 | 1) => {
      exactNavigationRef.current = null
      const scroller = scrollRef.current
      if (viewMode === 'page' && scroller) {
        const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
        const page = readerPagePosition(
          scroller.scrollLeft,
          scroller.scrollWidth,
          scroller.clientWidth,
        ).current
        const currentOffset = Math.min(maximum, (page - 1) * scroller.clientWidth)
        const atStart = page <= 1
        const atEnd = currentOffset >= maximum - 2
        if (direction < 0 && !atStart) {
          scroller.scrollTo({
            left: Math.max(0, currentOffset - scroller.clientWidth),
            behavior: readerMotionSafeScrollBehavior('smooth'),
          })
          return
        }
        if (direction > 0 && !atEnd) {
          scroller.scrollTo({
            left: Math.min(maximum, currentOffset + scroller.clientWidth),
            behavior: readerMotionSafeScrollBehavior('smooth'),
          })
          return
        }
      }
      const canChangeChapter =
        (direction < 0 && chapterIndex > 0) ||
        (direction > 0 && Boolean(document) && chapterIndex < (document?.chapters.length ?? 0) - 1)
      if (viewMode === 'page' && canChangeChapter) {
        pendingChapterFractionRef.current = direction < 0 ? 1 : 0
      }
      if (direction < 0 && chapterIndex > 0) setChapterIndex((value) => value - 1)
      if (direction > 0 && document && chapterIndex < document.chapters.length - 1) {
        setChapterIndex((value) => value + 1)
      }
    },
    [
      chapterIndex,
      document,
      exactNavigationRef,
      pendingChapterFractionRef,
      scrollRef,
      setChapterIndex,
      viewMode,
    ],
  )

  const currentReaderLocation = useCallback((): ReaderNavigationLocation => {
    const scroller = scrollRef.current
    if (!scroller) return { chapter: loadedChapterIndex, fraction: scrollFraction }
    const { offset, extent, viewport } = readerScrollAxis(scroller, viewMode)
    const exact = exactNavigationRef.current
    return {
      chapter: loadedChapterIndex,
      fraction: readerViewportFraction(offset, extent, viewport),
      ...(exact?.chapter === loadedChapterIndex ? { fragment: exact.fragment } : {}),
    }
  }, [exactNavigationRef, loadedChapterIndex, scrollFraction, scrollRef, viewMode])

  const applyReaderNavigation = useCallback(
    (location: ReaderNavigationLocation) => {
      const chapterTarget = Math.max(
        0,
        Math.min((document?.chapters.length ?? 1) - 1, Math.floor(location.chapter)),
      )
      const fraction = Math.max(0, Math.min(1, location.fraction))
      setHighlightTarget(null)
      if (chapterTarget === loadedChapterIndex) {
        setPendingFragment(null)
        if (location.fragment && articleRef.current) {
          exactNavigationRef.current = {
            chapter: chapterTarget,
            fragment: location.fragment,
          }
          const destination = readerFragmentTarget(articleRef.current, location.fragment)
          if (destination) revealReaderTarget(destination, 'start')
          return
        }
        exactNavigationRef.current = null
        const scroller = scrollRef.current
        if (!scroller) return
        seatReaderScroller(scroller, fraction, viewMode)
        return
      }
      exactNavigationRef.current = location.fragment
        ? { chapter: chapterTarget, fragment: location.fragment }
        : null
      pendingChapterFractionRef.current = location.fragment ? 0 : fraction
      setPendingFragment(
        location.fragment ? { chapter: chapterTarget, fragment: location.fragment } : null,
      )
      setChapterIndex(chapterTarget)
    },
    [
      articleRef,
      document?.chapters.length,
      exactNavigationRef,
      loadedChapterIndex,
      pendingChapterFractionRef,
      revealReaderTarget,
      scrollRef,
      setChapterIndex,
      setHighlightTarget,
      setPendingFragment,
      viewMode,
    ],
  )

  const navigateReader = useCallback(
    (location: ReaderNavigationLocation) => {
      const origin = currentReaderLocation()
      setNavigationTrail((trail) => pushReaderNavigation(trail, origin, location))
      applyReaderNavigation(location)
    },
    [applyReaderNavigation, currentReaderLocation],
  )

  const moveNavigationHistory = useCallback(
    (direction: 'back' | 'forward') => {
      const moved = moveReaderNavigation(navigationTrail, currentReaderLocation(), direction)
      if (!moved.location) return
      setNavigationTrail(moved.trail)
      applyReaderNavigation(moved.location)
    },
    [applyReaderNavigation, currentReaderLocation, navigationTrail],
  )

  // Another book starts a new trail, in the render that shows it.
  const [trailSource, setTrailSource] = useState(sourceKey)
  if (trailSource !== sourceKey) {
    setTrailSource(sourceKey)
    setNavigationTrail(emptyReaderNavigationTrail())
  }
  useEffect(() => {
    exactNavigationRef.current = null
  }, [exactNavigationRef, sourceKey])

  return { navigationTrail, turnReadingPosition, navigateReader, moveNavigationHistory }
}
