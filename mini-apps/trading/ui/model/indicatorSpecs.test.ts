import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import { INDICATORS, indicatorSpecFor, resolveIndicators } from './indicatorSpecs'

const bar = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
})
const bars = (n: number) => Array.from({ length: n }, (_, i) => bar(i + 1, 100 + (i % 7)))

describe('indicatorSpecFor — the parameterized catalog', () => {
  test('any parameterization is drawable, not just the presets', () => {
    const spec = indicatorSpecFor({ kind: 'ema', period: 200 })!
    expect(spec.id).toBe('ema:200')
    expect(spec.label).toBe('EMA 200')
    expect(spec.placement).toBe('overlay')
    const data = spec.compute(bars(210))
    expect(data.line!.length).toBeGreaterThan(0)
    // The honesty rule holds for the parameter, not a hardcoded 20: first point at bar 200.
    expect(Number(data.line![0]!.time)).toBe(200)
  })

  test('volume resolves to nothing to draw — it is built into the chart', () => {
    expect(indicatorSpecFor({ kind: 'volume' })).toBeNull()
  })

  test('the presets keep their historical colors (a re-skin is not a refactor)', () => {
    const colorOf = (id: string) => INDICATORS.find((s) => s.id === id)!.series[0]!.color
    expect(colorOf('sma:20')).toBe('#6aa8ff')
    expect(colorOf('sma:50')).toBe('#f0a13a')
    expect(colorOf('ema:20')).toBe('#c084fc')
  })

  test('two SMAs stay visually distinct (the parameterization cannot collapse the palette)', () => {
    const a = indicatorSpecFor({ kind: 'sma', period: 20 })!.series[0]!.color
    const b = indicatorSpecFor({ kind: 'sma', period: 50 })!.series[0]!.color
    expect(a).not.toBe(b)
  })
})

describe('resolveIndicators', () => {
  test('overlays come before panes, alphabetical within — pane indices stay deterministic', () => {
    const specs = resolveIndicators(new Set(['macd:12:26:9', 'ema:200', 'rsi:14', 'sma:20']))
    expect(specs.map((s) => s.id)).toEqual(['ema:200', 'sma:20', 'macd:12:26:9', 'rsi:14'])
  })

  test('unparseable ids and volume resolve to nothing rather than throwing', () => {
    expect(resolveIndicators(new Set(['nope', 'volume'])).length).toBe(0)
  })
})

// The active set + its migration/commands are the PREFS' concern, not the catalog's — see
// `indicatorPrefs.test.ts` for `applyIndicatorCommandV2` / `migrateIndicatorPrefsV2`.
