import type { ReaderPreferences, ReaderSpeedToken } from './model'
import { readerPageOffsetAtFraction } from './pagination'

/** Pure helpers behind the reading pane, kept apart from React so they can be tested directly. */

export type ReaderSidePanel = 'toc' | 'search' | 'saved' | 'bookmarks' | 'insights'

/** How long a scroll must stay quiet before a revealed target takes focus. */
export const READER_REVEAL_SETTLE_MS = 120
/** The latest a revealed target takes focus, even while layout keeps moving. */
export const READER_REVEAL_MAX_WAIT_MS = 1_200
/** How long the `lx-target-reveal` flash stays on a revealed block. */
export const READER_TARGET_REVEAL_MS = 2_000
/** How long a search or annotation highlight stays wrapped in its mark. */
export const READER_HIGHLIGHT_MS = 4_000

const SIDE_PANEL_TITLES: Record<ReaderSidePanel, string> = {
  toc: 'Contents',
  search: 'Search',
  saved: 'Annotations',
  bookmarks: 'Bookmarks',
  insights: 'Reading insights',
}

export function readerSidePanelTitle(panel: ReaderSidePanel): string {
  return SIDE_PANEL_TITLES[panel]
}

/** The panel body's region name; search names the whole book rather than the tab. */
export function readerSidePanelRegionLabel(panel: ReaderSidePanel): string {
  return panel === 'search' ? 'Book search' : SIDE_PANEL_TITLES[panel]
}

export function readerPageMargins(margin: ReaderPreferences['pageMargin']): {
  block: string
  inline: string
} {
  if (margin === 'compact') return { block: '1.5rem', inline: '1.25rem' }
  if (margin === 'roomy') return { block: '3.5rem', inline: '3rem' }
  return { block: '2.5rem', inline: '2rem' }
}

export function readerAnnotationExportFileName(bookTitle: string): string {
  const safeTitle = bookTitle.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-|-$/gu, '')
  return `${safeTitle || 'book'}-annotations.json`
}

const LIST_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End']

export function isReaderListKey(key: string): boolean {
  return LIST_KEYS.includes(key)
}

/** The index a list key moves to: Home/End jump, arrows step and clamp. */
export function readerListKeyIndex(key: string, current: number, length: number): number {
  if (key === 'Home') return 0
  if (key === 'End') return length - 1
  return Math.max(0, Math.min(length - 1, current + (key === 'ArrowDown' ? 1 : -1)))
}

/** The reading fraction a speed-reading token index stands for. */
export function readerSpeedFraction(tokenIndex: number, tokenCount: number): number {
  return tokenCount > 1 ? Math.max(0, Math.min(1, tokenIndex / (tokenCount - 1))) : 0
}

export function readerSpeedWpmStep(wpm: number, direction: 1 | -1): number {
  return Math.max(100, Math.min(600, wpm + direction * 25))
}

/** A token split around its focus letter, by code point. */
export function readerSpeedTokenParts(token: ReaderSpeedToken): [string, string, string] {
  const letters = Array.from(token.text)
  return [
    letters.slice(0, token.focusIndex).join(''),
    letters[token.focusIndex] ?? '',
    letters.slice(token.focusIndex + 1).join(''),
  ]
}

export interface ReaderScroller {
  scrollLeft: number
  scrollTop: number
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
}

/** Offset, extent and viewport along the axis the view mode reads in. */
export function readerScrollAxis(
  scroller: ReaderScroller,
  viewMode: ReaderPreferences['viewMode'],
): { offset: number; extent: number; viewport: number } {
  const paginated = viewMode === 'page'
  return {
    offset: paginated ? scroller.scrollLeft : scroller.scrollTop,
    extent: paginated ? scroller.scrollWidth : scroller.scrollHeight,
    viewport: paginated ? scroller.clientWidth : scroller.clientHeight,
  }
}

/** Places the scroller at a reading fraction: a page boundary when paginated, a pixel otherwise. */
export function seatReaderScroller(
  scroller: ReaderScroller,
  fraction: number,
  viewMode: ReaderPreferences['viewMode'],
): void {
  if (viewMode === 'page') {
    scroller.scrollLeft = readerPageOffsetAtFraction(
      fraction,
      scroller.scrollWidth,
      scroller.clientWidth,
    )
  } else {
    scroller.scrollTop = fraction * Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  }
}

/**
 * What the pane's open-failure row says: nothing while the first chapter loads or once a chapter
 * is open, the load error when there is one, otherwise that the book parsed with nothing to read.
 */
export function readerOpenFailureMessage({
  loading,
  error,
  hasDocument,
  hasChapter,
}: {
  loading: boolean
  error: string | null
  hasDocument: boolean
  hasChapter: boolean
}): string | null {
  if (loading && !hasChapter) return null
  if (error && !hasChapter) return error
  if (!hasDocument || !hasChapter) return 'Reader parsed this file but found no readable chapter.'
  return null
}
