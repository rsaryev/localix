import { describe, expect, test } from 'bun:test'
import { computeTabOverflow, tabOverflowEqual, NO_OVERFLOW } from './overflow'

describe('computeTabOverflow', () => {
  test('no overflow when content fits the viewport', () => {
    expect(computeTabOverflow({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })).toEqual(
      NO_OVERFLOW,
    )
    expect(computeTabOverflow({ scrollWidth: 200, clientWidth: 300, scrollLeft: 0 })).toEqual(
      NO_OVERFLOW,
    )
  })

  test('2px tolerance absorbs sub-pixel rounding (a near-fit shows no fade)', () => {
    // 1–2px wider than the viewport is treated as a fit, not an overflow.
    expect(computeTabOverflow({ scrollWidth: 302, clientWidth: 300, scrollLeft: 0 })).toEqual(
      NO_OVERFLOW,
    )
    // Just past the tolerance → overflow (clipped on the right, at the left edge).
    expect(computeTabOverflow({ scrollWidth: 303, clientWidth: 300, scrollLeft: 0 })).toEqual({
      left: false,
      right: true,
    })
  })

  test('scrolled to the start clips only the right edge', () => {
    expect(computeTabOverflow({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 })).toEqual({
      left: false,
      right: true,
    })
  })

  test('scrolled to the end clips only the left edge', () => {
    // maxScroll = 600 - 300 = 300; scrollLeft at the end.
    expect(computeTabOverflow({ scrollWidth: 600, clientWidth: 300, scrollLeft: 300 })).toEqual({
      left: true,
      right: false,
    })
  })

  test('scrolled to the middle clips both edges', () => {
    expect(computeTabOverflow({ scrollWidth: 600, clientWidth: 300, scrollLeft: 150 })).toEqual({
      left: true,
      right: true,
    })
  })

  test('within-tolerance scroll offsets do not flip an edge', () => {
    // 2px from the start/end is still treated as "at the edge".
    expect(computeTabOverflow({ scrollWidth: 600, clientWidth: 300, scrollLeft: 2 })).toEqual({
      left: false,
      right: true,
    })
    expect(computeTabOverflow({ scrollWidth: 600, clientWidth: 300, scrollLeft: 298 })).toEqual({
      left: true,
      right: false,
    })
  })

  test('honours a custom tolerance', () => {
    expect(computeTabOverflow({ scrollWidth: 305, clientWidth: 300, scrollLeft: 0 }, 10)).toEqual(
      NO_OVERFLOW,
    )
    expect(computeTabOverflow({ scrollWidth: 320, clientWidth: 300, scrollLeft: 0 }, 10)).toEqual({
      left: false,
      right: true,
    })
  })
})

describe('tabOverflowEqual', () => {
  test('compares both edges', () => {
    expect(tabOverflowEqual({ left: true, right: false }, { left: true, right: false })).toBe(true)
    expect(tabOverflowEqual({ left: true, right: false }, { left: false, right: false })).toBe(
      false,
    )
    expect(tabOverflowEqual({ left: true, right: true }, { left: true, right: false })).toBe(false)
  })
})
