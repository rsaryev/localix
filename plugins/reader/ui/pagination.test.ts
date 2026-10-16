import { describe, expect, test } from 'bun:test'

import {
  readerPageOffsetAtOffset,
  readerPageOffsetAtFraction,
  readerPagePosition,
  readerViewportFraction,
} from './pagination'

describe('reader pagination model', () => {
  test('maps horizontal page offsets to stable fractions and page counters', () => {
    expect(readerViewportFraction(800, 3_200, 800)).toBeCloseTo(1 / 3)
    expect(readerPagePosition(0, 3_200, 800)).toEqual({ current: 1, total: 4 })
    expect(readerPagePosition(1_590, 3_200, 800)).toEqual({
      current: 3,
      total: 4,
    })
    expect(readerPagePosition(9_999, 3_200, 800)).toEqual({
      current: 4,
      total: 4,
    })
    expect(readerPageOffsetAtFraction(0, 3_200, 800)).toBe(0)
    expect(readerPageOffsetAtFraction(0.5, 3_200, 800)).toBe(1_600)
    expect(readerPageOffsetAtFraction(1, 3_150, 800)).toBe(2_350)
  })

  test('snaps exact-link browser offsets to a complete viewport page', () => {
    expect(readerPageOffsetAtOffset(3_812, 8_000, 320)).toBe(3_840)
    expect(readerPageOffsetAtOffset(-20, 8_000, 320)).toBe(0)
    expect(readerPageOffsetAtOffset(8_500, 8_000, 320)).toBe(7_680)
  })
})
