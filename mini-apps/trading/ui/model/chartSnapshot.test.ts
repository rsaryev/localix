import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { parseChartSnapshotResult } from '../../backend/chart-snapshot'
import { buildChartSnapshot } from './chartSnapshot'
import { chartStateStore } from './chartStateStore'

afterEach(() => chartStateStore._clear())

// A fixture-only identity prevents parallel agent-command tests from publishing
// a live entry under the same chartStateStore key while this suite exercises
// the never-opened/localStorage fallback.
const CONN = 'public:snapshot-fixture'
const SYMBOL = 'BTC/USDC:USDC'
const TAB = 'trading:chart:public:snapshot-fixture:BTC%2FUSDC%3AUSDC'
const CHAT = 'chat-a'

describe('buildChartSnapshot — the snapshot reply', () => {
  test('a mounted tab answers its live state, and the reply round-trips the wire guard', () => {
    chartStateStore.patch(CHAT, TAB, {
      mounted: true,
      timeframe: '4h',
      chartType: 'candles',
      indicators: ['ema:200', 'rsi:14'],
      visibleRange: { from: 1_700_000_000, to: 1_700_360_000 },
      lastCandle: { time: 1_700_360_000, close: 64_000 },
    })
    const snap = buildChartSnapshot(CHAT, TAB, CONN, SYMBOL)
    expect(snap).toEqual({
      mounted: true,
      connectionId: CONN,
      symbol: SYMBOL,
      timeframe: '4h',
      chartType: 'candles',
      indicators: ['ema:200', 'rsi:14'],
      visibleRange: { from: 1_700_000_000, to: 1_700_360_000 },
      lastCandle: { time: 1_700_360_000, close: 64_000 },
    })
    // The exact object the sink sends is what the backend guard must accept.
    expect(parseChartSnapshotResult(snap)).toEqual(snap)
  })

  test('an unmounted tab keeps last-known prefs but DROPS viewport/candle claims', () => {
    chartStateStore.patch(CHAT, TAB, {
      mounted: true,
      timeframe: '1h',
      visibleRange: { from: 1, to: 2 },
      lastCandle: { time: 2, close: 10 },
    })
    chartStateStore.markUnmounted(CHAT, TAB)
    const snap = buildChartSnapshot(CHAT, TAB, CONN, SYMBOL)
    expect(snap.mounted).toBe(false)
    expect(snap.timeframe).toBe('1h')
    // A closed tab has no viewport — reporting a stale one would be a lie.
    expect(snap.visibleRange).toBeUndefined()
    expect(snap.lastCandle).toBeUndefined()
  })

  test("another chat's live chart of the market is not this chat's answer", () => {
    // Chat B has BTC on screen; chat A's agent asks about ITS BTC, which it never opened.
    chartStateStore.patch('chat-b', TAB, { mounted: true, timeframe: '1d' })
    const snap = buildChartSnapshot('chat-a', TAB, CONN, SYMBOL)
    expect(snap.mounted).toBe(false)
    expect(snap.timeframe).not.toBe('1d')
  })

  test('a never-opened tab answers mounted:false with remembered preferences only', () => {
    const snap = buildChartSnapshot(CHAT, TAB, CONN, SYMBOL)
    expect(snap.mounted).toBe(false)
    expect(snap.connectionId).toBe(CONN)
    expect(snap.symbol).toBe(SYMBOL)
    // No storage in the test env → the defaults the tab would open with.
    expect(snap.chartType).toBe('candles')
    expect(snap.indicators).toEqual([])
    expect(parseChartSnapshotResult(snap)).toEqual(snap)
  })
})

describe('buildChartSnapshot — drawings', () => {
  test('drawings the canvas published come back in the snapshot and pass the wire guard', () => {
    chartStateStore.patch(CHAT, TAB, {
      mounted: true,
      drawings: [
        { kind: 'hline', id: 'd1', price: 65_000, label: 'resistance' },
        { kind: 'vline', id: 'd2', time: 1_700_000_000, lineStyle: 'dotted' },
      ],
    })
    const snap = buildChartSnapshot(CHAT, TAB, CONN, SYMBOL)
    expect(snap.drawings).toHaveLength(2)
    expect(parseChartSnapshotResult(snap)).toEqual(snap)
    // Drawings persist per tab, so they stay honest for an UNMOUNTED tab too.
    chartStateStore.markUnmounted(CHAT, TAB)
    expect(buildChartSnapshot(CHAT, TAB, CONN, SYMBOL).drawings).toHaveLength(2)
  })

  test('an empty drawing list is omitted, not sent as []', () => {
    chartStateStore.patch(CHAT, TAB, { mounted: true, drawings: [] })
    expect(buildChartSnapshot(CHAT, TAB, CONN, SYMBOL).drawings).toBeUndefined()
  })
})

/** In-memory localStorage — bun has none; the never-opened-tab prefs read from a real store. */
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

describe('buildChartSnapshot — never-opened tab reads PER-TAB prefs', () => {
  let store: MemoryStorage
  beforeEach(() => {
    store = new MemoryStorage()
  })

  test("a never-opened tab reports its OWN per-tab chart type + indicators, not another tab's", () => {
    store.setItem(`localix.trading.chartType:${TAB}`, JSON.stringify('line'))
    store.setItem(
      `localix.trading.indicators:${TAB}`,
      JSON.stringify({ v: 2, items: [{ id: 'ema:200' }] }),
    )
    // A different tab's prefs must not bleed into this one's snapshot.
    store.setItem('localix.trading.chartType:trading:chart:c1:ETH', JSON.stringify('bars'))
    const snap = buildChartSnapshot(CHAT, TAB, CONN, SYMBOL, store)
    expect(snap.mounted).toBe(false)
    expect(snap.chartType).toBe('line')
    expect(snap.indicators).toEqual(['ema:200'])
    expect(parseChartSnapshotResult(snap)).toEqual(snap)
  })
})
