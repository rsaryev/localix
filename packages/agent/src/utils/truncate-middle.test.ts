/**
 * `truncateMiddle` — the direction whose whole point is that the marker is INSIDE the budget.
 */
import { describe, expect, test } from 'bun:test'

import { truncateMiddle } from './truncate-middle'

describe('truncateMiddle', () => {
  test('content within the budget is returned untouched', () => {
    expect(truncateMiddle('short', { maxChars: 100 })).toBe('short')
  })

  test('the result never exceeds the budget — the marker is counted, not appended', () => {
    // The bug this pins: keeping `max` chars and THEN appending a marker made every
    // "bounded" body longer than its cap.
    const body = 'x'.repeat(5000)
    for (const maxChars of [80, 200, 1000, 4999]) {
      expect(truncateMiddle(body, { maxChars }).length).toBeLessThanOrEqual(maxChars)
    }
  })

  test('both ends survive, so a body stays recognizable at each', () => {
    const body = `START${'m'.repeat(2000)}END`
    const out = truncateMiddle(body, { maxChars: 200 })
    expect(out.startsWith('START')).toBe(true)
    expect(out.endsWith('END')).toBe(true)
    expect(out).toContain('chars omitted')
  })

  test('a degenerate budget yields a marker prefix, never the whole input', () => {
    // `slice(-0)` returns the ENTIRE string: at a zero-sized tail this used to reproduce
    // the input it was asked to bound.
    const body = 'y'.repeat(500)
    const out = truncateMiddle(body, { maxChars: 10 })
    expect(out.length).toBeLessThanOrEqual(10)
    expect(out).not.toBe(body)
  })

  test('a non-positive budget yields nothing', () => {
    expect(truncateMiddle('anything', { maxChars: 0 })).toBe('')
    expect(truncateMiddle('anything', { maxChars: -5 })).toBe('')
  })

  test('an explicit head cap shifts the split toward the tail', () => {
    const body = `${'h'.repeat(1000)}${'t'.repeat(1000)}`
    const narrowHead = truncateMiddle(body, { maxChars: 300, maxHeadChars: 20 })
    const wideHead = truncateMiddle(body, { maxChars: 300 })
    const headOf = (s: string) => s.slice(0, s.indexOf('\n['))
    expect(headOf(narrowHead).length).toBeLessThan(headOf(wideHead).length)
    expect(narrowHead.length).toBeLessThanOrEqual(300)
  })
})
