import { describe, expect, test } from 'bun:test'

import {
  readerChapterEntryFraction,
  readerRestoredChapter,
  readerScrollReading,
} from './readerPosition'

const scroller = (top: number, left = 0) => ({
  scrollTop: top,
  scrollLeft: left,
  scrollHeight: 1_100,
  scrollWidth: 3_000,
  clientHeight: 100,
  clientWidth: 600,
})

describe('reader position restore', () => {
  test('opens on the stored chapter, an explicit request winning, clamped to the book', () => {
    const stored = { chapter: 3, fraction: 0.4 }
    expect(readerRestoredChapter(10, undefined, stored)).toBe(3)
    expect(readerRestoredChapter(10, 6, stored)).toBe(6)
    expect(readerRestoredChapter(10, undefined, null)).toBe(0)
    expect(readerRestoredChapter(2, undefined, stored)).toBe(1)
    expect(readerRestoredChapter(5, -4, null)).toBe(0)
  })

  test('restores the stored fraction only for the chapter it was saved in', () => {
    const stored = { chapter: 3, fraction: 0.4 }
    expect(readerChapterEntryFraction(3, null, stored)).toBe(0.4)
    expect(readerChapterEntryFraction(4, null, stored)).toBe(0)
    expect(readerChapterEntryFraction(0, null, null)).toBe(0)
  })

  test('a pending fraction from the turn that loaded the chapter wins over storage', () => {
    const stored = { chapter: 3, fraction: 0.4 }
    expect(readerChapterEntryFraction(3, 1, stored)).toBe(1)
    expect(readerChapterEntryFraction(3, 0, stored)).toBe(0)
  })
})

describe('reader scroll reading', () => {
  test('reads the vertical axis in scroll mode and records the chapter it belongs to', () => {
    const reading = readerScrollReading(scroller(500), 'scroll', 2, 9)
    expect(reading.fraction).toBe(0.5)
    expect(reading.progress).toEqual({ chapter: 2, fraction: 0.5, chapterCount: 9 })
  })

  test('reads the horizontal axis and page in page mode', () => {
    const reading = readerScrollReading(scroller(0, 1_200), 'page', 0, undefined)
    expect(reading.fraction).toBe(0.5)
    expect(reading.page).toEqual({ current: 3, total: 5 })
  })
})
