import type { ReaderPreferences, ReaderProgress } from './model'
import { readerPagePosition, readerViewportFraction } from './pagination'
import { readerScrollAxis, type ReaderScroller } from './readerPaneModel'

/**
 * The chapter a freshly opened book lands on: an explicit request wins, then the stored
 * position, then the first chapter — always clamped to the chapters the book actually has.
 */
export function readerRestoredChapter(
  chapterCount: number,
  initialChapter: number | undefined,
  stored: ReaderProgress | null,
): number {
  return Math.min(chapterCount - 1, Math.max(0, initialChapter ?? stored?.chapter ?? 0))
}

/**
 * Where a just-loaded chapter scrolls to. A pending fraction set by whoever turned the chapter
 * (an edge turn, history, speed reading) wins; otherwise the stored fraction applies only when it
 * was saved for this very chapter.
 */
export function readerChapterEntryFraction(
  chapterIndex: number,
  pending: number | null,
  stored: ReaderProgress | null,
): number {
  return pending ?? (stored?.chapter === chapterIndex ? stored.fraction : 0)
}

/** What one scroll event means: the fraction through the chapter, the page, and what to store. */
export function readerScrollReading(
  scroller: ReaderScroller,
  viewMode: ReaderPreferences['viewMode'],
  chapterIndex: number,
  chapterCount: number | undefined,
): {
  fraction: number
  page: { current: number; total: number }
  progress: ReaderProgress
} {
  const { offset, extent, viewport } = readerScrollAxis(scroller, viewMode)
  const fraction = readerViewportFraction(offset, extent, viewport)
  return {
    fraction,
    page: readerPagePosition(offset, extent, viewport),
    progress: { chapter: chapterIndex, fraction, chapterCount },
  }
}
