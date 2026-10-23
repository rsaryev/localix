import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { saveJSON } from '@localixai/mini-app-sdk/ui/storage'

import type { ReaderChapter, ReaderDocument } from '../shared/contracts'
import {
  readerSpeedStartIndex,
  readerSpeedTokens,
  type ReaderPreferences,
  type ReaderProgress,
} from './model'
import { readerSpeedFraction, seatReaderScroller } from './readerPaneModel'
import { progressKey } from './readerStorage'

/** How often a paused-by-visibility speed reader checks whether the tab is back. */
export const READER_SPEED_HIDDEN_RETRY_MS = 250

/** One-word-at-a-time reading over the chapter text, returning to the page where it stopped. */
export function useReaderSpeedReading({
  scrollRef,
  pendingChapterFractionRef,
  chapter,
  chapterIndex,
  setChapterIndex,
  document,
  sourceKey,
  visible,
  keyboardActive,
  viewMode,
  wpm,
  scrollFraction,
  setScrollFraction,
  stopAutoScroll,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  pendingChapterFractionRef: RefObject<number | null>
  chapter: ReaderChapter | null
  chapterIndex: number
  setChapterIndex: Dispatch<SetStateAction<number>>
  document: ReaderDocument | null
  sourceKey: string
  visible: boolean
  keyboardActive: boolean
  viewMode: ReaderPreferences['viewMode']
  wpm: number
  scrollFraction: number
  setScrollFraction: Dispatch<SetStateAction<number>>
  stopAutoScroll: () => void
}) {
  const [speedReadingOpen, setSpeedReadingOpen] = useState(false)
  const [speedReadingPlaying, setSpeedReadingPlaying] = useState(false)
  const [speedTokenIndex, setSpeedTokenIndex] = useState(0)
  const speedReadingTriggerRef = useRef<HTMLButtonElement>(null)
  const speedTokens = useMemo(() => readerSpeedTokens(chapter?.text ?? ''), [chapter?.text])

  const startSpeedReading = () => {
    if (!speedTokens.length) return
    stopAutoScroll()
    setSpeedTokenIndex(readerSpeedStartIndex(speedTokens.length, scrollFraction))
    setSpeedReadingOpen(true)
    setSpeedReadingPlaying(true)
  }

  const stopSpeedReading = (returnToText = true) => {
    const fraction = readerSpeedFraction(speedTokenIndex, speedTokens.length)
    setSpeedReadingPlaying(false)
    setSpeedReadingOpen(false)
    if (!returnToText) return
    setScrollFraction(fraction)
    saveJSON(progressKey(sourceKey), {
      chapter: chapterIndex,
      fraction,
      chapterCount: document?.chapters.length,
    } satisfies ReaderProgress)
    requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      seatReaderScroller(scroller, fraction, viewMode)
      speedReadingTriggerRef.current?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    if (
      !speedReadingOpen ||
      !speedReadingPlaying ||
      !visible ||
      !keyboardActive ||
      chapter?.index !== chapterIndex
    )
      return
    const token = speedTokens[speedTokenIndex]
    if (!token) return
    let timer = 0
    const advance = () => {
      if (globalThis.document.visibilityState === 'hidden') {
        timer = window.setTimeout(advance, READER_SPEED_HIDDEN_RETRY_MS)
        return
      }
      if (speedTokenIndex < speedTokens.length - 1) {
        setSpeedTokenIndex((value) => value + 1)
        return
      }
      if (document && chapterIndex < document.chapters.length - 1) {
        pendingChapterFractionRef.current = 0
        setSpeedTokenIndex(0)
        setChapterIndex((value) => value + 1)
        return
      }
      // Playback stops on the last word, visibly; a durable row would only repeat it.
      setSpeedReadingPlaying(false)
    }
    timer = window.setTimeout(advance, Math.round((60_000 / wpm) * token.pauseFactor))
    return () => window.clearTimeout(timer)
  }, [
    chapter?.index,
    chapterIndex,
    document,
    keyboardActive,
    pendingChapterFractionRef,
    setChapterIndex,
    wpm,
    speedReadingOpen,
    speedReadingPlaying,
    speedTokenIndex,
    speedTokens,
    visible,
  ])

  return {
    speedReadingOpen,
    speedReadingPlaying,
    setSpeedReadingPlaying,
    speedTokenIndex,
    setSpeedTokenIndex,
    speedTokens,
    speedReadingTriggerRef,
    startSpeedReading,
    stopSpeedReading,
  }
}
