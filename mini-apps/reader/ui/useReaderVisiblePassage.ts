import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { ReaderChapter, ReaderDocument } from '../shared/contracts'
import { readerVisiblePassage, type ReaderPreferences } from './model'

/** The text currently on screen, recomputed a frame after scroll or layout changes. */
export function useReaderVisiblePassage({
  articleRef,
  scrollRef,
  chapter,
  scrollFraction,
  preferences,
}: {
  articleRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  chapter: ReaderChapter | null
  scrollFraction: number
  preferences: ReaderPreferences
}) {
  const [visiblePassage, setVisiblePassage] = useState('')
  const visiblePassageFrameRef = useRef(0)

  const scheduleVisiblePassage = useCallback(
    (fraction: number) => {
      cancelAnimationFrame(visiblePassageFrameRef.current)
      visiblePassageFrameRef.current = requestAnimationFrame(() => {
        const article = articleRef.current
        const scroller = scrollRef.current
        if (!article || !scroller || !chapter) return
        setVisiblePassage(readerVisiblePassage(article, scroller, chapter.text, fraction))
      })
    },
    [articleRef, chapter, scrollRef],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => scheduleVisiblePassage(scrollFraction))
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(visiblePassageFrameRef.current)
    }
  }, [
    chapter,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.measure,
    preferences.viewMode,
    scheduleVisiblePassage,
    scrollFraction,
  ])

  return { visiblePassage, setVisiblePassage }
}

/** True while the pane is too narrow to keep the book panel docked beside the page. The
 *  workspace element only exists once a chapter renders, so the observer re-binds on both. */
export function useReaderNarrowPane(
  workspaceRef: RefObject<HTMLDivElement | null>,
  chapter: ReaderChapter | null,
  document: ReaderDocument | null,
): boolean {
  const [narrowPane, setNarrowPane] = useState(false)
  useEffect(() => {
    const root = workspaceRef.current
    if (!root) return
    const sync = () => setNarrowPane(root.clientWidth <= 704)
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    sync()
    return () => observer.disconnect()
  }, [chapter, document, workspaceRef])
  return narrowPane
}
