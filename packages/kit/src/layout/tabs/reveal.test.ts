import { describe, expect, test } from 'bun:test'
import { computeRevealScrollLeft, type RevealMetrics } from './reveal'

/** A 300px viewport over 1000px of tabs: 700px of scroll room. */
const metrics = (over: Partial<RevealMetrics> = {}): RevealMetrics => ({
  clientWidth: 300,
  scrollWidth: 1000,
  scrollLeft: 0,
  itemStart: 0,
  itemWidth: 100,
  ...over,
})

/** The TabBar reserves its two 32px scroll chevrons; TabStrip its 24px fades. */
const CHEVRONS = { start: 32, end: 32 }

describe('computeRevealScrollLeft — when to do nothing', () => {
  test('a strip that does not overflow is never scrolled', () => {
    expect(computeRevealScrollLeft(metrics({ scrollWidth: 300 }))).toBeNull()
  })

  test('an item already comfortably in view is left alone', () => {
    expect(computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 100 }))).toBeNull()
  })

  // Writing scrollLeft cancels an in-flight fling, so a sub-pixel correction must
  // not be written at all.
  test('a move within the tolerance is not worth cancelling momentum for', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 100, itemStart: 99.5, itemWidth: 100 })),
    ).toBeNull()
  })
})

describe('computeRevealScrollLeft — bringing an item back', () => {
  test('an item clipped on the left aligns to the start, clear of the reserve', () => {
    expect(computeRevealScrollLeft(metrics({ scrollLeft: 400, itemStart: 300 }), CHEVRONS)).toBe(
      268,
    )
  })

  test('an item clipped on the right aligns to the end, clear of the reserve', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 250, itemWidth: 100 }), CHEVRONS),
    ).toBe(82)
  })

  test('without a reserve it aligns flush to the viewport edge', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 250, itemWidth: 100 })),
    ).toBe(50)
  })
})

describe('computeRevealScrollLeft — the first and last item are reachable', () => {
  // The clamp is the fix: aiming past an end lands EXACTLY on it, so the edge tabs
  // stop parking a sliver off-screen (and, for TabBar, underneath a chevron button).
  test('the first item lands on scrollLeft 0 even with a start reserve', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 700, itemStart: 0, itemWidth: 100 }), CHEVRONS),
    ).toBe(0)
  })

  test('the last item lands on the maximum scroll even with an end reserve', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 900, itemWidth: 100 }), CHEVRONS),
    ).toBe(700)
  })

  test('once at the end, revealing the last item is a no-op', () => {
    expect(
      computeRevealScrollLeft(
        metrics({ scrollLeft: 700, itemStart: 900, itemWidth: 100 }),
        CHEVRONS,
      ),
    ).toBeNull()
  })
})

describe('computeRevealScrollLeft — degenerate geometry', () => {
  test('the reserves never eat more than a third of a narrow viewport each', () => {
    // clientWidth 60 → each 32px reserve is capped at 20, leaving a 20px window to
    // aim at. Uncapped they would have consumed the viewport twice over.
    expect(
      computeRevealScrollLeft(
        { clientWidth: 60, scrollWidth: 600, scrollLeft: 0, itemStart: 200, itemWidth: 10 },
        CHEVRONS,
      ),
    ).toBe(170)
  })

  test('an item wider than the room it gets pins its start, not its tail', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 100, itemWidth: 400 }), CHEVRONS),
    ).toBe(68)
  })

  test('a too-wide item already covering the whole viewport is left alone', () => {
    expect(
      computeRevealScrollLeft(metrics({ scrollLeft: 0, itemStart: 0, itemWidth: 400 }), CHEVRONS),
    ).toBeNull()
  })
})
