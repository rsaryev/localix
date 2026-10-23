import { describe, expect, test } from 'bun:test'
import type { Candle, Market } from './contracts'
import type { ResourceTradingService } from './resource-shared'
import { expandTechnicals } from './resource-expand-technicals'

const market = { symbol: 'BTC/USDC:USDC', contract: true } as Market

const risingCandles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: i * 3600,
    open: 100 + i,
    high: 100 + i + 0.5,
    low: 100 + i - 0.5,
    close: 100 + i,
    volume: 10,
  }))

const fakeService = (candles: Candle[]): ResourceTradingService =>
  ({
    markets: async () => [market],
    ohlcv: async () => candles,
  }) as unknown as ResourceTradingService

describe('expandTechnicals', () => {
  test('renders the rating tables + house lenses from freshly read candles', async () => {
    const out = await expandTechnicals(fakeService(risingCandles(260)), 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // Names the connection (the user asked the context carry the right connection id).
    expect(out.content).toContain('connection c1')
    expect(out.content).toContain('Technical rating for BTC/USDC:USDC')
    // Both classic tables and the summary gauge verdict.
    expect(out.content).toContain('Oscillator votes')
    expect(out.content).toContain('Moving-average votes')
    expect(out.content).toMatch(/Summary: (STRONG BUY|BUY)/)
    // The house lenses beyond the classic tables.
    expect(out.content).toContain('Beyond the classics')
    expect(out.content).toContain('session VWAP')
  })

  test('rates a short window too, abstaining on the long moving averages', async () => {
    // 30 bars can't warm SMA/EMA 200; the rating still renders, those rows just read "—".
    const out = await expandTechnicals(fakeService(risingCandles(30)), 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toContain('Simple Moving Average (200): — → —')
  })

  test('fails honestly below the minimum window', async () => {
    const out = await expandTechnicals(fakeService(risingCandles(2)), 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('not enough')
  })

  test('fails honestly when the venue has no candles', async () => {
    const out = await expandTechnicals(fakeService([]), 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(false)
  })
})

describe('timeframe ladder', () => {
  test("the leaf carries each rung's summary verdict when the venue serves them", async () => {
    const out = await expandTechnicals(fakeService(risingCandles(260)), 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).toContain('timeframe ladder')
    // Every rung answered (the fake serves any timeframe) with an upper-cased verdict.
    for (const tf of ['5m', '15m', '1h', '4h', '1d']) {
      expect(out.content).toMatch(new RegExp(`${tf} (STRONG BUY|BUY|NEUTRAL)`))
    }
  })

  test('a venue serving only ONE rung yields no ladder line (one rung is the rating itself)', async () => {
    const service = {
      markets: async () => [market],
      ohlcv: async (_u: string, _id: string, _s: string, timeframe: string) => {
        if (timeframe !== '1h') throw new Error('timeframe not offered')
        return risingCandles(260)
      },
    } as unknown as ResourceTradingService
    const out = await expandTechnicals(service, 'u', 'c1', 'BTC/USDC:USDC')
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.content).not.toContain('timeframe ladder')
  })
})
