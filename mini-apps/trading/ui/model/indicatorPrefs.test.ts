import { beforeEach, describe, expect, test } from 'bun:test'
import {
  applyIndicatorCommandV2,
  loadIndicatorPrefsV2,
  migrateIndicatorPrefsV2,
  patchIndicatorPref,
  rekeyIndicatorPref,
  saveIndicatorPrefsV2,
  toggleIndicatorV2,
  type IndicatorPrefRecord,
} from './indicatorPrefs'

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

describe('migrateIndicatorPrefsV2 — total, version-free', () => {
  test('a bare string array is not prefs', () => {
    expect(migrateIndicatorPrefsV2(['sma20', 'EMA 200'])).toEqual({ v: 2, items: [] })
  })

  test('a v2 object round-trips, invalid override fields are shed field-by-field', () => {
    const prefs = migrateIndicatorPrefsV2({
      v: 2,
      items: [
        { id: 'rsi:14', hidden: true, color: '#aabbcc', range: { min: 0, max: 100 } },
        { id: 'ema:20', color: 'red', range: { min: 5, max: 5 }, paneHeight: 10 },
        { id: 'volume', hidden: true },
      ],
      scaleMode: 'log',
    })
    expect(prefs).toEqual({
      v: 2,
      items: [
        { id: 'rsi:14', hidden: true, color: '#aabbcc', range: { min: 0, max: 100 } },
        { id: 'ema:20' }, // bad color, degenerate range, sub-minimum pane height all shed
      ],
      scaleMode: 'log',
    })
  })

  test('garbage is an empty v2 value; duplicate canonical ids keep the first record', () => {
    expect(migrateIndicatorPrefsV2(null)).toEqual({ v: 2, items: [] })
    expect(migrateIndicatorPrefsV2('x')).toEqual({ v: 2, items: [] })
    expect(migrateIndicatorPrefsV2({ scaleMode: 'sideways' })).toEqual({ v: 2, items: [] })
    // `sma20` and `sma:20` fold into one id — the first spelling's record wins.
    const prefs = migrateIndicatorPrefsV2({
      v: 2,
      items: [
        { id: 'sma20', hidden: true },
        { id: 'sma:20', color: '#aabbcc' },
      ],
    })
    expect(prefs.items).toEqual([{ id: 'sma:20', hidden: true }])
  })
})

describe('applyIndicatorCommandV2', () => {
  const items: IndicatorPrefRecord[] = [
    { id: 'rsi:14', hidden: true, range: { min: 0, max: 100 } },
    { id: 'ema:20', color: '#aabbcc' },
  ]

  test('set preserves overrides for surviving ids and starts new ids clean', () => {
    const next = applyIndicatorCommandV2(items, 'set', ['rsi14', 'macd'])
    expect(next).toEqual([
      { id: 'rsi:14', hidden: true, range: { min: 0, max: 100 } },
      { id: 'macd:12:26:9' },
    ])
  })

  test('add is idempotent, remove drops by canonical id, clear empties', () => {
    expect(applyIndicatorCommandV2(items, 'add', ['EMA 20'])).toEqual(items)
    expect(applyIndicatorCommandV2(items, 'remove', ['ema20'])).toEqual([items[0]!])
    expect(applyIndicatorCommandV2(items, 'clear', [])).toEqual([])
  })

  test('volume and garbage are dropped silently (the tool already fix-it’d them)', () => {
    // `volume` is built into the chart — accepting it as an indicator would promise a
    // series nobody adds; junk never reached a valid id in the first place.
    expect(applyIndicatorCommandV2([], 'set', ['volume', 'junk', 'sma:20'])).toEqual([
      { id: 'sma:20' },
    ])
  })
})

describe('toggleIndicatorV2 / patchIndicatorPref / rekeyIndicatorPref', () => {
  test('toggle adds a clean record and removes an existing one', () => {
    const on = toggleIndicatorV2([], 'sma:20')
    expect(on).toEqual([{ id: 'sma:20' }])
    expect(toggleIndicatorV2(on, 'sma:20')).toEqual([])
  })

  test('range and rangeAuto are two poles of one choice', () => {
    let items: IndicatorPrefRecord[] = [{ id: 'rsi:14' }]
    items = patchIndicatorPref(items, 'rsi:14', { range: { min: 20, max: 80 } })
    expect(items[0]).toEqual({ id: 'rsi:14', range: { min: 20, max: 80 } })
    items = patchIndicatorPref(items, 'rsi:14', { rangeAuto: true })
    expect(items[0]).toEqual({ id: 'rsi:14', rangeAuto: true })
    items = patchIndicatorPref(items, 'rsi:14', { range: { min: 0, max: 100 } })
    expect(items[0]).toEqual({ id: 'rsi:14', range: { min: 0, max: 100 } })
  })

  test('hidden and color set and clear; a degenerate range patch is ignored', () => {
    let items: IndicatorPrefRecord[] = [{ id: 'ema:20' }]
    items = patchIndicatorPref(items, 'ema:20', { hidden: true, color: '#aabbcc' })
    expect(items[0]).toEqual({ id: 'ema:20', hidden: true, color: '#aabbcc' })
    items = patchIndicatorPref(items, 'ema:20', { hidden: false, color: null })
    expect(items[0]).toEqual({ id: 'ema:20' })
    items = patchIndicatorPref(items, 'ema:20', { range: { min: 5, max: 5 } })
    expect(items[0]).toEqual({ id: 'ema:20' })
  })

  test('rekey carries overrides to the new id; a collision is a no-op', () => {
    const items: IndicatorPrefRecord[] = [{ id: 'rsi:14', hidden: true }, { id: 'ema:20' }]
    expect(rekeyIndicatorPref(items, 'rsi:14', 'rsi:21')).toEqual([
      { id: 'rsi:21', hidden: true },
      { id: 'ema:20' },
    ])
    expect(rekeyIndicatorPref(items, 'rsi:14', 'ema:20')).toEqual(items)
  })
})

describe('loadIndicatorPrefsV2 / saveIndicatorPrefsV2 — per-tab persistence', () => {
  const GLOBAL = 'localix.trading.indicators'
  const TAB_A = 'trading:chart:c1:BTC'
  const TAB_B = 'trading:chart:c1:ETH'
  let store: MemoryStorage

  beforeEach(() => {
    store = new MemoryStorage()
  })

  test("one tab's indicator records do not affect another's", () => {
    saveIndicatorPrefsV2({ v: 2, items: [{ id: 'sma:20' }] }, TAB_A, store)
    saveIndicatorPrefsV2(
      { v: 2, items: [{ id: 'rsi:14', hidden: true }], scaleMode: 'log' },
      TAB_B,
      store,
    )
    expect(loadIndicatorPrefsV2(TAB_A, store).items).toEqual([{ id: 'sma:20' }])
    expect(loadIndicatorPrefsV2(TAB_B, store)).toEqual({
      v: 2,
      items: [{ id: 'rsi:14', hidden: true }],
      scaleMode: 'log',
    })
  })

  test('a tab with no per-tab entry starts empty, whatever the bare key holds', () => {
    store.setItem(GLOBAL, JSON.stringify({ v: 2, items: [{ id: 'sma:20' }] }))
    expect(loadIndicatorPrefsV2(TAB_A, store).items).toEqual([])
  })

  test('without a tab id, load and save speak the global key directly', () => {
    saveIndicatorPrefsV2({ v: 2, items: [{ id: 'sma:20' }] }, undefined, store)
    expect(JSON.parse(store.getItem(GLOBAL)!).items).toEqual([{ id: 'sma:20' }])
    expect(loadIndicatorPrefsV2(undefined, store).items).toEqual([{ id: 'sma:20' }])
  })
})
