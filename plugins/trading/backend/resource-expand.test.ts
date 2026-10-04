import { describe, expect, test } from 'bun:test'

import type { Ticker } from './contracts'
import { oneLineTicker } from './resource-expand'

/**
 * Behavior lock for oneLineTicker — the one pure, agent-facing formatter in resource-expand
 * (the rest orchestrate service reads). It renders the `localix://resource/trade/` quote line the agent reads,
 * and shares orderBookSpread with the market_data tool so the two can't drift. Ticker.change is
 * a FRACTION (normalizeTicker stores percentage/100), so the `× 100` here is the percent — pin
 * that, plus each optional part appearing only when its data is present (no em-dash noise).
 */
const tick = (over: Partial<Ticker>): Ticker => ({ symbol: 'BTC/USDT', ...over }) as Ticker

describe('oneLineTicker', () => {
  test('a full ticker renders change%, spread (bps), 24h range and volume', () => {
    const out = oneLineTicker(
      tick({ last: 100, change: 0.05, bid: 99, ask: 101, high: 110, low: 90, baseVolume: 1000 }),
    )
    expect(out).toBe(
      'Quote: last 100 (5.00% 24h) · bid 99 / ask 101 · spread 2 (200.0 bps) · 24h H 110 L 90 · vol 1000.',
    )
  })

  test('an absent change omits the percent', () => {
    expect(oneLineTicker(tick({ last: 100, bid: 99, ask: 101 }))).not.toContain('% 24h')
  })

  test('a one-sided book omits the spread (no fabricated tightness)', () => {
    const out = oneLineTicker(tick({ last: 100, bid: 99 })) // no ask
    expect(out).not.toContain('spread')
    expect(out).toContain('ask —')
  })

  test('a thin ticker omits the 24h range rather than printing em-dashes', () => {
    const out = oneLineTicker(tick({ last: 100 }))
    expect(out).not.toContain('24h H')
  })

  test('quoteVolume is the fallback when baseVolume is absent', () => {
    expect(oneLineTicker(tick({ last: 100, quoteVolume: 2_000_000 }))).toContain(
      'quote vol 2000000',
    )
    expect(oneLineTicker(tick({ last: 100, baseVolume: 5 }))).toContain('vol 5')
  })
})
