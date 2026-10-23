import { afterEach, describe, expect, test } from 'bun:test'

import { chartStateStore } from './chartStateStore'

afterEach(() => chartStateStore._clear())

/** The chat the single-chat cases address; the per-chat cases name their own two. */
const CHAT = 'chat-a'

describe("chartStateStore — the snapshot read-back's state registry", () => {
  test("one chat's chart of a market is not another chat's chart of it", () => {
    // Keyed by market alone, chat B's BTC overwrote chat A's timeframe, and A's agent read B's.
    chartStateStore.patch('chat-a', 'btc', { mounted: true, timeframe: '1h' })
    chartStateStore.patch('chat-b', 'btc', { mounted: true, timeframe: '1d' })
    expect(chartStateStore.get('chat-a', 'btc')?.timeframe).toBe('1h')
    expect(chartStateStore.get('chat-b', 'btc')?.timeframe).toBe('1d')
  })

  test('ofSession lists only that chat’s charts, by chart tab id', () => {
    chartStateStore.patch('chat-a', 'btc', { mounted: true })
    chartStateStore.patch('chat-b', 'eth', { mounted: true })
    chartStateStore.patch('chat-ab', 'sol', { mounted: true })
    expect(chartStateStore.ofSession('chat-a').map(([tabId]) => tabId)).toEqual(['btc'])
  })

  test('patch upserts and merges partials, whichever publisher writes first', () => {
    // ChartCanvas (child) publishes before TradingChartTab (parent) on mount.
    chartStateStore.patch(CHAT, 'tab-1', { chartType: 'area' })
    chartStateStore.patch(CHAT, 'tab-1', { mounted: true })
    chartStateStore.patch(CHAT, 'tab-1', { timeframe: '4h' })
    expect(chartStateStore.get(CHAT, 'tab-1')).toEqual({
      mounted: true,
      chartType: 'area',
      timeframe: '4h',
    })
  })

  test('a first write defaults mounted to false — only the tab declares itself mounted', () => {
    chartStateStore.patch(CHAT, 'tab-1', { indicators: ['ema:200'] })
    expect(chartStateStore.get(CHAT, 'tab-1')?.mounted).toBe(false)
  })

  test('markUnmounted keeps the last-known state, flipped to mounted:false', () => {
    chartStateStore.patch(CHAT, 'tab-1', {
      mounted: true,
      timeframe: '1h',
      visibleRange: { from: 1, to: 2 },
      lastCandle: { time: 2, close: 10 },
    })
    chartStateStore.markUnmounted(CHAT, 'tab-1')
    expect(chartStateStore.get(CHAT, 'tab-1')).toEqual({
      mounted: false,
      timeframe: '1h',
      visibleRange: { from: 1, to: 2 },
      lastCandle: { time: 2, close: 10 },
    })
  })

  test('markUnmounted on an unknown tab is a no-op (never creates ghosts)', () => {
    chartStateStore.markUnmounted(CHAT, 'tab-x')
    expect(chartStateStore.get(CHAT, 'tab-x')).toBeUndefined()
  })

  test('the map is capped — the oldest entry is evicted, existing keys keep patching', () => {
    for (let i = 0; i < 64; i++) chartStateStore.patch(CHAT, `tab-${i}`, { timeframe: '1h' })
    chartStateStore.patch(CHAT, 'tab-new', { timeframe: '5m' })
    expect(chartStateStore.get(CHAT, 'tab-0')).toBeUndefined()
    expect(chartStateStore.get(CHAT, 'tab-new')?.timeframe).toBe('5m')
    // Patching an EXISTING key is a merge, not an insert — no eviction.
    chartStateStore.patch(CHAT, 'tab-new', { mounted: true })
    expect(chartStateStore.get(CHAT, 'tab-1')).toBeDefined()
  })
})
