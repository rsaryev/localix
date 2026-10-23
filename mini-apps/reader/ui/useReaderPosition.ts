import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { saveJSON } from '@localixai/mini-app-sdk/ui/storage'

import type { ReaderPreferences } from './model'
import type { ReaderPagePosition } from './pagination'
import { progressKey } from './readerStorage'
import { readerScrollReading } from './readerPosition'
import type { ReaderScroller } from './readerPaneModel'
import type { ReaderPendingFragment } from './useReaderTargetReveal'

/**
 * The single owner of the reading POSITION inside the open chapter: the scroll fraction, the
 * page, and the one-shot requests other hooks leave for the next layout —
 *
 * - `pendingChapterFractionRef`: where the NEXT chapter load should land (an edge turn, history,
 *   speed reading). Consumed once by chapter loading.
 * - `modeSwitchFractionRef`: the fraction the page layout must restore after it re-measures (a
 *   chapter load or a scroll/page mode switch).
 * - `exactNavigationRef`: the fragment a history move landed on, dropped by the next manual scroll.
 */
export interface ReaderPosition {
  scrollFraction: number
  setScrollFraction: Dispatch<SetStateAction<number>>
  pagePosition: ReaderPagePosition
  setPagePosition: Dispatch<SetStateAction<ReaderPagePosition>>
  pendingChapterFractionRef: { current: number | null }
  modeSwitchFractionRef: { current: number | null }
  exactNavigationRef: { current: ReaderPendingFragment | null }
  /** Reads a scroll event into the position and stores it as the book's progress. */
  recordScroll: (scroller: ReaderScroller) => void
  /** Keeps the current fraction across a view-mode change. */
  holdForModeSwitch: () => void
}

export function useReaderPosition({
  sourceKey,
  chapterIndex,
  chapterCount,
  viewMode,
}: {
  sourceKey: string
  chapterIndex: number
  chapterCount: number | undefined
  viewMode: ReaderPreferences['viewMode']
}): ReaderPosition {
  const [scrollFraction, setScrollFraction] = useState(0)
  const [pagePosition, setPagePosition] = useState<ReaderPagePosition>({ current: 1, total: 1 })
  const pendingChapterFractionRef = useRef<number | null>(null)
  const modeSwitchFractionRef = useRef<number | null>(null)
  const exactNavigationRef = useRef<ReaderPendingFragment | null>(null)

  const recordScroll = useCallback(
    (scroller: ReaderScroller) => {
      const reading = readerScrollReading(scroller, viewMode, chapterIndex, chapterCount)
      setScrollFraction(reading.fraction)
      setPagePosition(reading.page)
      saveJSON(progressKey(sourceKey), reading.progress)
    },
    [chapterCount, chapterIndex, sourceKey, viewMode],
  )

  const holdForModeSwitch = useCallback(() => {
    modeSwitchFractionRef.current = scrollFraction
  }, [scrollFraction])

  return {
    scrollFraction,
    setScrollFraction,
    pagePosition,
    setPagePosition,
    pendingChapterFractionRef,
    modeSwitchFractionRef,
    exactNavigationRef,
    recordScroll,
    holdForModeSwitch,
  }
}
