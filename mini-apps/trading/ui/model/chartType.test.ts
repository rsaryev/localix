import { beforeEach, describe, expect, test } from 'bun:test'
import type { UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
import {
  CHART_TYPES,
  DEFAULT_CHART_TYPE,
  LINE_CHART_COLOR,
  loadChartType,
  mainSeriesData,
  mainSeriesOptions,
  mainSeriesPoint,
  normalizeChartType,
  reduceChartType,
  saveChartType,
} from './chartType'

/** In-memory localStorage — bun has none; the per-tab persistence tests need a real store. */
class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}

const bar: Candle = { time: 1000, open: 10, high: 12, low: 9, close: 11, volume: 5 }
/** Chart `Time` is a branded number; expectations brand theirs the same way. */
const t = (n: number) => n as UTCTimestamp

describe('normalizeChartType', () => {
  test('the four canonical tokens pass through', () => {
    for (const t of CHART_TYPES) expect(normalizeChartType(t)).toBe(t)
  })

  test('natural spellings are tolerated', () => {
    expect(normalizeChartType('candle')).toBe('candles')
    expect(normalizeChartType('Candlestick')).toBe('candles')
    expect(normalizeChartType(' BAR ')).toBe('bars')
    expect(normalizeChartType('ohlc')).toBe('bars')
  })

  test('anything else is null — never a guess', () => {
    expect(normalizeChartType('heikin')).toBeNull()
    expect(normalizeChartType(42)).toBeNull()
    expect(normalizeChartType(null)).toBeNull()
  })
})

describe('reduceChartType — the reducer', () => {
  test('a valid request wins; an invalid one keeps the current type (never blanks the chart)', () => {
    expect(reduceChartType('candles', 'line')).toBe('line')
    expect(reduceChartType('line', 'garbage')).toBe('line')
    expect(reduceChartType('area', undefined)).toBe('area')
  })

  test('the default is candles — what the chart has always opened on', () => {
    expect(DEFAULT_CHART_TYPE).toBe('candles')
  })
})

describe('mainSeriesPoint / mainSeriesData — the per-type data shapes', () => {
  test('candles and bars carry full OHLC', () => {
    for (const type of ['candles', 'bars'] as const) {
      expect(mainSeriesPoint(type, bar)).toEqual({
        time: t(1000),
        open: 10,
        high: 12,
        low: 9,
        close: 11,
      })
    }
  })

  test('line and area read the close', () => {
    for (const type of ['line', 'area'] as const) {
      expect(mainSeriesPoint(type, bar)).toEqual({ time: t(1000), value: 11 })
    }
  })

  test('mainSeriesData maps every bar in order', () => {
    const candles = [bar, { ...bar, time: 2000, close: 12 }]
    expect(mainSeriesData('line', candles)).toEqual([
      { time: t(1000), value: 11 },
      { time: t(2000), value: 12 },
    ])
  })
})

describe('mainSeriesOptions — theme colors per type', () => {
  const colors = { up: '#0f0', down: '#f00' }

  test('candles and bars take the up/down semantics', () => {
    expect(mainSeriesOptions('candles', colors)).toMatchObject({
      upColor: '#0f0',
      downColor: '#f00',
      wickUpColor: '#0f0',
    })
    expect(mainSeriesOptions('bars', colors)).toMatchObject({ upColor: '#0f0', downColor: '#f00' })
  })

  test('line and area take the fixed accent — a single line has no up/down', () => {
    expect(mainSeriesOptions('line', colors)).toMatchObject({ color: LINE_CHART_COLOR })
    expect(mainSeriesOptions('area', colors)).toMatchObject({ lineColor: LINE_CHART_COLOR })
  })
})

describe('loadChartType / saveChartType — per-tab persistence', () => {
  const GLOBAL = 'localix.trading.chartType'
  const TAB_A = 'trading:chart:c1:BTC'
  const TAB_B = 'trading:chart:c1:ETH'
  let store: MemoryStorage

  beforeEach(() => {
    store = new MemoryStorage()
  })

  test("one tab's chart type does not affect another's", () => {
    saveChartType('line', TAB_A, store)
    saveChartType('bars', TAB_B, store)
    expect(loadChartType(TAB_A, store)).toBe('line')
    expect(loadChartType(TAB_B, store)).toBe('bars')
    expect(store.getItem(`${GLOBAL}:${TAB_A}`)).toBe('"line"')
    expect(store.getItem(GLOBAL)).toBeNull()
  })

  test('a tab with no per-tab entry shows the default, whatever the bare key holds', () => {
    store.setItem(GLOBAL, JSON.stringify('area'))
    expect(loadChartType(TAB_A, store)).toBe(DEFAULT_CHART_TYPE)
  })

  test('an unknown/absent value falls back to the default, never blanks the chart', () => {
    expect(loadChartType(TAB_A, store)).toBe(DEFAULT_CHART_TYPE)
    store.setItem(`${GLOBAL}:${TAB_A}`, JSON.stringify('heikin'))
    expect(loadChartType(TAB_A, store)).toBe(DEFAULT_CHART_TYPE)
  })

  test('no tab id reads/writes the bare key directly', () => {
    saveChartType('area', undefined, store)
    expect(store.getItem(GLOBAL)).toBe('"area"')
    expect(loadChartType(undefined, store)).toBe('area')
  })
})
