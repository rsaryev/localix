import { describe, expect, test } from 'bun:test'

import {
  BREADCRUMB_FLOOR,
  fitStatusStrip,
  STATUS_STRIP_METRICS,
  statusStripBudget,
  STRIP_FLOOR,
  STRIP_MAX_SHARE,
} from './status-strip-fit'

const { gap, compact, roomy, overflow, core } = STATUS_STRIP_METRICS

/**
 * The titlebar width that leaves the strip at least `px`, at the shallowest trail.
 *
 * Two constraints, and the wider one wins: the strip stops at the row's centre, and it only gets
 * what is left once the core cluster and the trail's floor are paid for.
 */
const widthFor = (px: number) => Math.ceil(Math.max(2 * px, px + core + BREADCRUMB_FLOOR))

describe('what the strip is allowed to spend', () => {
  test('a shallow trail hands over the room it is not using', () => {
    // The point of asking for depth: `[Global]` alone has no use for half a 1600px titlebar, and
    // the share-of-the-row model gave the strip the same 640px either way.
    const shallow = statusStripBudget(1600, 1)
    const deep = statusStripBudget(1600, 5)
    expect(shallow).toBeGreaterThanOrEqual(deep)
  })

  test('the strip stops at the centre of the window however much the trail leaves', () => {
    for (const width of [900, 1440, 1920, 3000]) {
      expect(statusStripBudget(width, 1)).toBeLessThanOrEqual(width * STRIP_MAX_SHARE)
    }
  })

  test('a deep path takes its room back', () => {
    // On a roomy row the centre cap binds first and depth changes nothing — which is correct, and
    // is why this asks at a width where the trail genuinely needs the left half.
    expect(statusStripBudget(1000, 6)).toBeLessThan(statusStripBudget(1000, 1))
    expect(statusStripBudget(760, 5)).toBeLessThan(statusStripBudget(760, 1))
  })

  test('the strip never vanishes, however narrow the window or deep the path', () => {
    // An empty strip and a broken plugin host look identical. The trail truncates instead — that
    // is what its `minmax(0,1fr)` column is for.
    for (const width of [420, 560, 700]) {
      expect(statusStripBudget(width, 6)).toBeGreaterThanOrEqual(
        Math.min(STRIP_FLOOR, width * STRIP_MAX_SHARE),
      )
    }
  })

  test('the trail keeps a floor of its own — the strip does not take the last of it', () => {
    for (const width of [900, 1200, 1600]) {
      expect(width - core - statusStripBudget(width, 1)).toBeGreaterThanOrEqual(BREADCRUMB_FLOOR)
    }
  })

  test('an unstated depth is the conservative guess, never the generous one', () => {
    expect(statusStripBudget(1440)).toBeLessThanOrEqual(statusStripBudget(1440, 1))
  })
})

describe('contributed status strip fit', () => {
  test('before the first measurement every item is on the bar, as a glyph', () => {
    // The regression this pins: the unmeasured frame used to show a flat FOUR and fold the rest
    // into `…`, which is the frame users actually saw — a titlebar with ten plugins opened with
    // four glyphs and a menu, and only a resize replaced it. Compact fits at any plausible
    // titlebar width, so nothing has to be hidden to render safely before measuring.
    expect(fitStatusStrip({ containerWidth: null, count: 9, max: 12 })).toEqual({
      visible: 9,
      compact: true,
    })
  })

  test('the ceiling still applies before a measurement', () => {
    expect(fitStatusStrip({ containerWidth: null, count: 14, max: 12 })).toEqual({
      visible: 12,
      compact: true,
    })
  })

  test('every bundled titlebar plugin fits an ordinary window', () => {
    // The user-facing promise: on any window worth calling a desktop one, a plugin that has
    // something to say gets a glyph on the bar rather than a row in `…`.
    for (const titlebar of [900, 1100, 1440, 1920]) {
      const fit = fitStatusStrip({
        containerWidth: titlebar,
        count: 12,
        max: 12,
        breadcrumbDepth: 2,
      })
      expect(fit.visible, `titlebar ${titlebar}px`).toBe(12)
    }
  })

  test('a roomy titlebar keeps every item’s live text', () => {
    const fit = fitStatusStrip({
      containerWidth: widthFor(4 * roomy + 3 * gap),
      count: 4,
      max: 8,
      breadcrumbDepth: 1,
    })
    expect(fit).toEqual({ visible: 4, compact: false })
  })

  test('text is dropped before an item is — the whole point of the model', () => {
    // Items that no longer fit with their text still fit as glyphs, so they all stay on the bar
    // and their text moves to the tooltip. The old fixed cap could only hide them.
    const fit = fitStatusStrip({
      containerWidth: widthFor(8 * compact + 7 * gap),
      count: 8,
      max: 12,
      breadcrumbDepth: 1,
    })
    expect(fit).toEqual({ visible: 8, compact: true })
  })

  test('a narrow titlebar still fits several glyphs, and the rest fold', () => {
    const fit = fitStatusStrip({ containerWidth: 520, count: 12, max: 12, breadcrumbDepth: 4 })
    expect(fit.compact).toBe(true)
    expect(fit.visible).toBeGreaterThanOrEqual(4)
    expect(fit.visible).toBeLessThan(12)
  })

  test('the ceiling holds however wide the window gets', () => {
    // Twenty glyphs is a menu, not a status bar, and a bar that grows without bound leaves the
    // navigation path nowhere to truncate.
    const fit = fitStatusStrip({ containerWidth: 6000, count: 20, max: 12 })
    expect(fit.visible).toBe(12)
    expect(fit.compact).toBe(true)
  })

  test('nothing contributed asks for nothing — no overflow, no compaction', () => {
    expect(fitStatusStrip({ containerWidth: 1400, count: 0, max: 8 })).toEqual({
      visible: 0,
      compact: false,
    })
  })

  test('a strip with no room shows no items rather than one that overflows its box', () => {
    expect(fitStatusStrip({ containerWidth: 40, count: 5, max: 8 }).visible).toBe(0)
  })

  test('widening never shows fewer items than a narrower titlebar did', () => {
    // Monotonicity is what stops the strip oscillating while a window is dragged: the decision
    // depends only on the host row's width and the trail's depth, neither of which any item's own
    // width can move.
    for (const depth of [1, 3, 5]) {
      let previous = 0
      for (let width = 200; width <= 2400; width += 17) {
        const { visible } = fitStatusStrip({
          containerWidth: width,
          count: 12,
          max: 12,
          breadcrumbDepth: depth,
        })
        expect(visible, `depth ${depth} at ${width}px`).toBeGreaterThanOrEqual(previous)
        previous = visible
      }
      expect(previous).toBe(12)
    }
  })

  test('a deepening path never widens the strip', () => {
    // The other monotonicity: opening a sub-session must not make plugin glyphs APPEAR. A trail
    // that grows can only ever take room back.
    for (const width of [700, 1100, 1600]) {
      let previous = Number.POSITIVE_INFINITY
      for (let depth = 1; depth <= 6; depth += 1) {
        const { visible } = fitStatusStrip({
          containerWidth: width,
          count: 12,
          max: 12,
          breadcrumbDepth: depth,
        })
        expect(visible, `${width}px at depth ${depth}`).toBeLessThanOrEqual(previous)
        previous = visible
      }
    }
  })

  test('the `…` trigger is paid for out of the strip, never out of the last item', () => {
    // Room for the trigger plus three glyphs and no more: the excess is handed over, never
    // truncated away, and the trigger never overlaps the item beside it.
    const budget = statusStripBudget(560, 6)
    const fit = fitStatusStrip({ containerWidth: 560, count: 20, max: 12, breadcrumbDepth: 6 })
    const used = fit.visible * compact + Math.max(0, fit.visible - 1) * gap + gap + overflow
    expect(used).toBeLessThanOrEqual(budget)
  })
})
