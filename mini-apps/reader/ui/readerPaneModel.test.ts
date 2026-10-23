import { describe, expect, test } from 'bun:test'

import {
  READER_REVEAL_MAX_WAIT_MS,
  READER_REVEAL_SETTLE_MS,
  READER_TARGET_REVEAL_MS,
  isReaderListKey,
  readerAnnotationExportFileName,
  readerListKeyIndex,
  readerOpenFailureMessage,
  readerPageMargins,
  readerScrollAxis,
  readerSidePanelRegionLabel,
  readerSidePanelTitle,
  readerSpeedFraction,
  readerSpeedTokenParts,
  readerSpeedWpmStep,
  seatReaderScroller,
} from './readerPaneModel'

const scroller = (overrides: Partial<Record<string, number>> = {}) => ({
  scrollLeft: 0,
  scrollTop: 0,
  scrollWidth: 1000,
  scrollHeight: 2000,
  clientWidth: 250,
  clientHeight: 500,
  ...overrides,
})

describe('reader pane model', () => {
  test('keeps the reveal timings in their settle < ceiling < flash order', () => {
    expect(READER_REVEAL_SETTLE_MS).toBe(120)
    expect(READER_REVEAL_MAX_WAIT_MS).toBe(1_200)
    expect(READER_TARGET_REVEAL_MS).toBe(2_000)
  })

  test('names the side panel tabs, with search named for the book', () => {
    expect(readerSidePanelTitle('saved')).toBe('Annotations')
    expect(readerSidePanelTitle('search')).toBe('Search')
    expect(readerSidePanelRegionLabel('search')).toBe('Book search')
    expect(readerSidePanelRegionLabel('insights')).toBe('Reading insights')
  })

  test('maps page margins to their inset pairs, defaulting to balanced', () => {
    expect(readerPageMargins('compact')).toEqual({ block: '1.5rem', inline: '1.25rem' })
    expect(readerPageMargins('roomy')).toEqual({ block: '3.5rem', inline: '3rem' })
    expect(readerPageMargins('balanced')).toEqual({ block: '2.5rem', inline: '2rem' })
  })

  test('builds a portable export file name from any title', () => {
    expect(readerAnnotationExportFileName('War & Peace: Vol 1')).toBe(
      'War-Peace-Vol-1-annotations.json',
    )
    expect(
      readerAnnotationExportFileName(
        '\u0410\u043d\u043d\u0430 \u041a\u0430\u0440\u0435\u043d\u0438\u043d\u0430',
      ),
    ).toBe(
      '\u0410\u043d\u043d\u0430-\u041a\u0430\u0440\u0435\u043d\u0438\u043d\u0430-annotations.json',
    )
    expect(readerAnnotationExportFileName('???')).toBe('book-annotations.json')
  })

  test('moves list focus with Home, End and clamped arrows', () => {
    expect(isReaderListKey('ArrowDown')).toBe(true)
    expect(isReaderListKey('Enter')).toBe(false)
    expect(readerListKeyIndex('Home', 4, 9)).toBe(0)
    expect(readerListKeyIndex('End', 4, 9)).toBe(8)
    expect(readerListKeyIndex('ArrowDown', 4, 9)).toBe(5)
    expect(readerListKeyIndex('ArrowUp', 0, 9)).toBe(0)
    expect(readerListKeyIndex('ArrowDown', 8, 9)).toBe(8)
  })

  test('converts speed-reading progress and pace', () => {
    expect(readerSpeedFraction(5, 11)).toBe(0.5)
    expect(readerSpeedFraction(0, 1)).toBe(0)
    expect(readerSpeedFraction(20, 11)).toBe(1)
    expect(readerSpeedWpmStep(300, 1)).toBe(325)
    expect(readerSpeedWpmStep(590, 1)).toBe(600)
    expect(readerSpeedWpmStep(110, -1)).toBe(100)
  })

  test('splits a speed token around its focus letter by code point', () => {
    expect(readerSpeedTokenParts({ text: 'reading', focusIndex: 2, pauseFactor: 1 })).toEqual([
      're',
      'a',
      'ding',
    ])
    expect(readerSpeedTokenParts({ text: '😀ab', focusIndex: 1, pauseFactor: 1 })).toEqual([
      '😀',
      'a',
      'b',
    ])
    expect(readerSpeedTokenParts({ text: 'a', focusIndex: 3, pauseFactor: 1 })).toEqual([
      'a',
      '',
      '',
    ])
  })

  test('reads and seats the scroller along the view mode axis', () => {
    expect(readerScrollAxis(scroller({ scrollLeft: 250 }), 'page')).toEqual({
      offset: 250,
      extent: 1000,
      viewport: 250,
    })
    expect(readerScrollAxis(scroller({ scrollTop: 300 }), 'scroll')).toEqual({
      offset: 300,
      extent: 2000,
      viewport: 500,
    })
    const vertical = scroller()
    seatReaderScroller(vertical, 0.5, 'scroll')
    expect(vertical.scrollTop).toBe(750)
    expect(vertical.scrollLeft).toBe(0)
    const paged = scroller()
    seatReaderScroller(paged, 1, 'page')
    expect(paged.scrollLeft).toBe(750)
    expect(paged.scrollTop).toBe(0)
  })
})

describe('reader open failure message', () => {
  const state = { loading: false, error: null, hasDocument: true, hasChapter: true }
  test('stays silent while the first chapter loads and once a chapter is open', () => {
    expect(readerOpenFailureMessage({ ...state, loading: true, hasChapter: false })).toBeNull()
    expect(readerOpenFailureMessage({ ...state, error: 'late failure' })).toBeNull()
  })
  test('reports the load error, then a book with nothing to read', () => {
    expect(readerOpenFailureMessage({ ...state, error: 'Broken', hasChapter: false })).toBe(
      'Broken',
    )
    expect(readerOpenFailureMessage({ ...state, hasDocument: false })).toBe(
      'Reader parsed this file but found no readable chapter.',
    )
  })
})
