import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'

import type { ReaderPreferences, ReaderTextTarget } from './model'
import { useReaderAutoScroll } from './useReaderAutoScroll'
import type { ReaderDocumentState } from './useReaderDocumentLoading'
import { useReaderNavigation } from './useReaderNavigation'
import type { ReaderPosition } from './useReaderPosition'
import { useReaderSpeedReading } from './useReaderSpeedReading'
import { useReaderTargetReveal, type ReaderPendingFragment } from './useReaderTargetReveal'

/**
 * Everything that MOVES the reading position: auto-scroll, speed reading, target reveal and the
 * navigation history. Each one reads and writes the position through `useReaderPosition`'s refs
 * and setters, which is why they are wired together here rather than in the pane.
 */
export function useReaderMovement({
  refs,
  book,
  position,
  preferences,
  sourceKey,
  active,
  highlight,
}: {
  refs: { scroll: RefObject<HTMLDivElement | null>; article: RefObject<HTMLElement | null> }
  book: Pick<
    ReaderDocumentState,
    'document' | 'chapter' | 'chapterIndex' | 'setChapterIndex' | 'loadedChapterIndex'
  >
  position: ReaderPosition
  preferences: ReaderPreferences
  sourceKey: string
  active: { visible: boolean; keyboardActive: boolean }
  highlight: {
    target: ReaderTextTarget | null
    setTarget: Dispatch<SetStateAction<ReaderTextTarget | null>>
  }
}) {
  const { document, chapter, chapterIndex, setChapterIndex, loadedChapterIndex } = book
  const { scrollFraction, setScrollFraction, pendingChapterFractionRef } = position
  const { visible, keyboardActive } = active
  const { viewMode } = preferences
  const [pendingFragment, setPendingFragment] = useState<ReaderPendingFragment | null>(null)
  const clearPendingFragment = useCallback(() => setPendingFragment(null), [])

  const autoScroll = useReaderAutoScroll({
    scrollRef: refs.scroll,
    pendingChapterFractionRef,
    setChapterIndex,
    chapter,
    chapterIndex,
    document,
    visible,
    keyboardActive,
    viewMode,
    speed: preferences.autoScrollSpeed,
  })
  const revealReaderTarget = useReaderTargetReveal({
    articleRef: refs.article,
    scrollRef: refs.scroll,
    viewMode,
    chapter,
    highlightTarget: highlight.target,
    loadedChapterIndex,
    pendingFragment,
    clearPendingFragment,
    exactNavigationRef: position.exactNavigationRef,
  })
  const navigation = useReaderNavigation({
    scrollRef: refs.scroll,
    articleRef: refs.article,
    document,
    sourceKey,
    chapterIndex,
    setChapterIndex,
    loadedChapterIndex,
    scrollFraction,
    viewMode,
    revealReaderTarget,
    setHighlightTarget: highlight.setTarget,
    setPendingFragment,
    pendingChapterFractionRef,
    exactNavigationRef: position.exactNavigationRef,
  })
  const speed = useReaderSpeedReading({
    scrollRef: refs.scroll,
    pendingChapterFractionRef,
    chapter,
    chapterIndex,
    setChapterIndex,
    document,
    sourceKey,
    visible,
    keyboardActive,
    viewMode,
    wpm: preferences.speedReadingWpm,
    scrollFraction,
    setScrollFraction,
    stopAutoScroll: autoScroll.stopAutoScroll,
  })
  return { autoScroll, navigation, speed }
}
