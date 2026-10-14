import { describe, expect, test } from 'bun:test'
import {
  decideWheelScroll,
  normalizeWheelDelta,
  IGNORE_WHEEL,
  WHEEL_LINE_PX,
  type StripScrollMetrics,
  type WheelIntent,
} from '@localixai/kit/lib'

/** A 300px-wide strip holding 1000px of tabs: 700px of scroll room. */
const strip = (scrollLeft: number): StripScrollMetrics => ({
  scrollWidth: 1000,
  clientWidth: 300,
  scrollLeft,
  scrollHeight: 32,
  clientHeight: 32,
})

const wheel = (deltaY: number, deltaX = 0, deltaMode = 0): WheelIntent => ({
  deltaX,
  deltaY,
  deltaMode,
})

describe('normalizeWheelDelta', () => {
  test('pixel mode passes through', () => {
    expect(normalizeWheelDelta(120, 0, 300)).toBe(120)
  })

  test('line mode is scaled to pixels (Firefox reports 3 lines per notch)', () => {
    expect(normalizeWheelDelta(3, 1, 300)).toBe(3 * WHEEL_LINE_PX)
  })

  test('page mode is scaled by the viewport', () => {
    expect(normalizeWheelDelta(1, 2, 300)).toBe(300)
  })
})

describe('decideWheelScroll — what the strip may take over', () => {
  test('a real vertical scroller keeps its own wheel', () => {
    expect(
      decideWheelScroll(wheel(100), { ...strip(0), scrollHeight: 200, clientHeight: 32 }),
    ).toEqual(IGNORE_WHEEL)
  })

  test('a strip with no horizontal overflow is left alone', () => {
    expect(decideWheelScroll(wheel(100), { ...strip(0), scrollWidth: 300 })).toEqual(IGNORE_WHEEL)
  })

  test('a vertical mouse wheel scrolls the strip horizontally', () => {
    expect(decideWheelScroll(wheel(100), strip(0))).toEqual({ type: 'scroll', scrollLeft: 100 })
    expect(decideWheelScroll(wheel(-100), strip(400))).toEqual({ type: 'scroll', scrollLeft: 300 })
  })

  test('a line-mode notch moves a useful distance, not 3px', () => {
    expect(decideWheelScroll(wheel(3, 0, 1), strip(0))).toEqual({ type: 'scroll', scrollLeft: 48 })
  })

  // The regression: a trackpad swipe carries the gesture in deltaX. Taking it over
  // cancelled that deltaX and re-applied the tiny orthogonal deltaY instead, so the
  // strip crawled and — with an inertial deltaY that alternates sign near the end —
  // sprang back off the boundary instead of settling on the last tab.
  test('a horizontally-dominant gesture is left to the browser (and its inertia)', () => {
    expect(decideWheelScroll(wheel(1, -40), strip(300))).toEqual(IGNORE_WHEEL)
    expect(decideWheelScroll(wheel(-2, 60), strip(300))).toEqual(IGNORE_WHEEL)
  })

  test('a vertical trackpad swipe still counts as vertical despite deltaX noise', () => {
    expect(decideWheelScroll(wheel(-12, 0.4), strip(100))).toEqual({
      type: 'scroll',
      scrollLeft: 88,
    })
  })
})

describe('decideWheelScroll — boundaries', () => {
  test('an overshooting wheel clamps onto the end instead of overscrolling', () => {
    expect(decideWheelScroll(wheel(400), strip(500))).toEqual({ type: 'scroll', scrollLeft: 700 })
    expect(decideWheelScroll(wheel(-400), strip(120))).toEqual({ type: 'scroll', scrollLeft: 0 })
  })

  // Pinned at an end we cannot consume the wheel, so we must not preventDefault it:
  // otherwise the page stops scrolling whenever the pointer rests over a tab bar.
  test('at the right end a further wheel is handed back to the page', () => {
    expect(decideWheelScroll(wheel(100), strip(700))).toEqual(IGNORE_WHEEL)
  })

  test('at the left end a further wheel is handed back to the page', () => {
    expect(decideWheelScroll(wheel(-100), strip(0))).toEqual(IGNORE_WHEEL)
  })

  test('the opposite direction is still consumable at an end', () => {
    expect(decideWheelScroll(wheel(-100), strip(700))).toEqual({ type: 'scroll', scrollLeft: 600 })
  })

  test('a zero-delta wheel is a no-op', () => {
    expect(decideWheelScroll(wheel(0, 0), strip(300))).toEqual(IGNORE_WHEEL)
  })
})
