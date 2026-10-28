import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'

import type { ReaderChapter, ReaderDocument } from '../shared/contracts'
import { readerAutoScrollDistance, type ReaderPreferences } from './model'

/** How long the scroller may sit at its end before auto-scroll turns the chapter. */
export const READER_AUTO_SCROLL_STALL_MS = 800

/** Hands-free scrolling in scroll view: a frame loop that turns the chapter at its end. */
export function useReaderAutoScroll({
  scrollRef,
  pendingChapterFractionRef,
  setChapterIndex,
  chapter,
  chapterIndex,
  document,
  visible,
  keyboardActive,
  viewMode,
  speed,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  pendingChapterFractionRef: RefObject<number | null>
  setChapterIndex: Dispatch<SetStateAction<number>>
  chapter: ReaderChapter | null
  chapterIndex: number
  document: ReaderDocument | null
  visible: boolean
  keyboardActive: boolean
  viewMode: ReaderPreferences['viewMode']
  speed: number
}) {
  const [autoScrollActive, setAutoScrollActive] = useState(false)
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)
  const autoScrollFrameRef = useRef(0)
  const autoScrollRemainderRef = useRef(0)
  const autoScrollStallRef = useRef<number | null>(null)

  const clearAutoScrollFrame = useCallback(() => {
    cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollRemainderRef.current = 0
    autoScrollStallRef.current = null
  }, [])

  const stopAutoScroll = useCallback(() => {
    clearAutoScrollFrame()
    setAutoScrollActive(false)
    setAutoScrollPaused(false)
  }, [clearAutoScrollFrame])

  const startAutoScroll = useCallback(() => {
    setAutoScrollActive(true)
    setAutoScrollPaused(false)
  }, [])

  // Scrolling by itself needs the scrolled view on screen: leaving either ends it, in the render
  // that left, and what the frames kept is cleared once that is committed.
  const unavailable = viewMode !== 'scroll' || !visible
  if (unavailable && (autoScrollActive || autoScrollPaused)) {
    setAutoScrollActive(false)
    setAutoScrollPaused(false)
  }
  useEffect(() => {
    if (unavailable) clearAutoScrollFrame()
  }, [unavailable, clearAutoScrollFrame])

  useEffect(() => {
    if (
      !autoScrollActive ||
      autoScrollPaused ||
      viewMode !== 'scroll' ||
      !visible ||
      !keyboardActive ||
      !chapter ||
      !document
    ) {
      cancelAnimationFrame(autoScrollFrameRef.current)
      return
    }
    let lastFrame = performance.now()
    const tick = (now: number) => {
      const scroller = scrollRef.current
      if (!scroller || globalThis.document.visibilityState === 'hidden') {
        lastFrame = now
        autoScrollFrameRef.current = requestAnimationFrame(tick)
        return
      }
      const elapsed = now - lastFrame
      lastFrame = now
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const before = scroller.scrollTop
      const distance = autoScrollRemainderRef.current + readerAutoScrollDistance(speed, elapsed)
      const pixels = Math.floor(distance)
      autoScrollRemainderRef.current = distance - pixels
      if (pixels <= 0) {
        autoScrollFrameRef.current = requestAnimationFrame(tick)
        return
      }
      scroller.scrollTop = Math.min(maximum, before + pixels)
      if (scroller.scrollTop > before) {
        autoScrollStallRef.current = null
      } else if (autoScrollStallRef.current === null) {
        autoScrollStallRef.current = now
      } else if (now - autoScrollStallRef.current >= READER_AUTO_SCROLL_STALL_MS) {
        autoScrollStallRef.current = null
        autoScrollRemainderRef.current = 0
        if (chapterIndex < document.chapters.length - 1) {
          pendingChapterFractionRef.current = 0
          setChapterIndex((value) => value + 1)
        } else {
          // Scrolling stops on the last page; that is the whole message, not an Event Center row.
          stopAutoScroll()
        }
        return
      }
      autoScrollFrameRef.current = requestAnimationFrame(tick)
    }
    autoScrollFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(autoScrollFrameRef.current)
  }, [
    autoScrollActive,
    autoScrollPaused,
    chapter,
    chapterIndex,
    document,
    keyboardActive,
    pendingChapterFractionRef,
    scrollRef,
    setChapterIndex,
    speed,
    viewMode,
    stopAutoScroll,
    visible,
  ])

  return {
    autoScrollActive,
    autoScrollPaused,
    setAutoScrollPaused,
    startAutoScroll,
    stopAutoScroll,
  }
}
