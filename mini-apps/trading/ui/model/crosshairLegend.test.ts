import { describe, expect, test } from 'bun:test'
import { buildCrosshairLegend, isAwayFromRealtime } from './crosshairLegend'
import { readCode } from '@localixai/source-lint'

describe('buildCrosshairLegend', () => {
  test('up bar: positive change, +1 sign', () => {
    const l = buildCrosshairLegend({ open: 100, high: 110, low: 99, close: 108 }, 12)
    expect(l).not.toBeNull()
    expect(l!.sign).toBe(1)
    expect(l!.changeAbs).toBe(8)
    expect(l!.changePct).toBeCloseTo(0.08, 10)
    expect(l!.volume).toBe(12)
    // Range is high−low (11), amplitude vs open (11%) — the volatility change (close−open) hides.
    expect(l!.rangeAbs).toBe(11)
    expect(l!.rangePct).toBeCloseTo(0.11, 10)
  })

  test('a bar that wicks hard but closes flat still reports its range', () => {
    // close === open → changeAbs 0, but the bar swung 20 wide: the range is what shows the volatility.
    const l = buildCrosshairLegend({ open: 100, high: 112, low: 92, close: 100 }, 5)
    expect(l!.changeAbs).toBe(0)
    expect(l!.rangeAbs).toBe(20)
    expect(l!.rangePct).toBeCloseTo(0.2, 10)
  })

  test('down bar: negative change, -1 sign', () => {
    const l = buildCrosshairLegend({ open: 100, high: 101, low: 90, close: 95 }, 3)
    expect(l!.sign).toBe(-1)
    expect(l!.changeAbs).toBe(-5)
  })

  test('flat bar (close === open) is sign 0 with 0 change', () => {
    const l = buildCrosshairLegend({ open: 50, high: 51, low: 49, close: 50 }, 0)
    expect(l!.sign).toBe(0)
    expect(l!.changeAbs).toBe(0)
    // A finite 0 volume is a real reading (a bar can genuinely trade nothing), not a fabrication.
    expect(l!.volume).toBe(0)
  })

  test('a missing/non-finite volume stays null — never a fabricated 0', () => {
    expect(buildCrosshairLegend({ open: 1, high: 2, low: 1, close: 2 }, null)!.volume).toBeNull()
    expect(
      buildCrosshairLegend({ open: 1, high: 2, low: 1, close: 2 }, undefined)!.volume,
    ).toBeNull()
    expect(
      buildCrosshairLegend({ open: 1, high: 2, low: 1, close: 2 }, Number.NaN)!.volume,
    ).toBeNull()
  })

  test('open of 0 yields no percent (division guarded), change still stated', () => {
    const l = buildCrosshairLegend({ open: 0, high: 5, low: 0, close: 4 }, 1)
    expect(l!.changePct).toBeNull()
    expect(l!.changeAbs).toBe(4)
    // Same guard for range: no percent off a 0 open, but the absolute range is still real.
    expect(l!.rangePct).toBeNull()
    expect(l!.rangeAbs).toBe(5)
  })

  test('null bar or a non-finite price → null (render nothing, not em-dashes)', () => {
    expect(buildCrosshairLegend(null, 1)).toBeNull()
    expect(buildCrosshairLegend(undefined, 1)).toBeNull()
    expect(buildCrosshairLegend({ open: Number.NaN, high: 1, low: 1, close: 1 }, 1)).toBeNull()
    expect(buildCrosshairLegend({ open: 1, high: 1, low: 1, close: Infinity }, 1)).toBeNull()
  })
})

describe('isAwayFromRealtime', () => {
  test('at the live edge (scrollPosition 0) is not away', () => {
    expect(isAwayFromRealtime(0)).toBe(false)
  })

  test('a sub-bar wobble at the edge is absorbed by the slack', () => {
    expect(isAwayFromRealtime(-0.5)).toBe(false)
    expect(isAwayFromRealtime(-1)).toBe(false) // exactly one bar of slack, still at edge
  })

  test('panned into history (negative offset beyond slack) is away', () => {
    expect(isAwayFromRealtime(-2)).toBe(true)
    expect(isAwayFromRealtime(-40)).toBe(true)
  })

  test('honours a non-zero realtime offset baseline', () => {
    // With a realtime rightOffset of 5, the edge sits at 5; 5 and 4.5 are still "at" the edge.
    expect(isAwayFromRealtime(5, 5)).toBe(false)
    expect(isAwayFromRealtime(4.5, 5)).toBe(false)
    expect(isAwayFromRealtime(3, 5)).toBe(true)
  })

  test('a rightOffset of 6 keeps the live edge at 6, not 0', () => {
    // The regression the call site must not re-introduce: with breathing room of 6, scrollPosition
    // at the edge IS 6. Compared against the parameter default of 0 it would read as "away" forever.
    expect(isAwayFromRealtime(6, 6)).toBe(false)
    expect(isAwayFromRealtime(4, 6)).toBe(true)
  })

  test('non-finite scroll position is never treated as away', () => {
    expect(isAwayFromRealtime(Number.NaN)).toBe(false)
    expect(isAwayFromRealtime(Infinity)).toBe(false)
  })
})

describe('chart pointer call-site coupling (source lint)', () => {
  // A comment cannot enforce that the caller passes the chart's real rightOffset. This does: the
  // predicate is worthless if the call site drops the second argument (it silently uses the default
  // 0), so pin that the "away" subscription reads `scrollPosition()` AND `options().rightOffset`.
  // Same defect class as the `void refresh()` overlap-guard trap: type-checks, tests-pass, feature
  // silently gone.
  const src = readCode(new URL('../ui/useChartPointer.ts', import.meta.url))

  test('the isAwayFromRealtime call passes the chart-configured rightOffset', () => {
    // Tolerate whitespace/line-wrapping but require both reads inside the single call expression.
    const call = src.match(/isAwayFromRealtime\(([\s\S]*?)\)\)/)
    expect(call, 'isAwayFromRealtime(...) call not found in useChartPointer').not.toBeNull()
    const args = call![1]!
    expect(args).toContain('scrollPosition()')
    expect(args).toContain('options().rightOffset')
  })
})
