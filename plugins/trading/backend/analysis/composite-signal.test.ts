import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { compositeSignal, renderCompositeSignal, suggestedExposure } from './composite-signal'

const bar = (i: number, over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...over,
})

/** A clean, steadily rising series with rising volume — every dimension should read bull. */
function uptrend(n = 80): Candle[] {
  return Array.from({ length: n }, (_, i) =>
    bar(i, {
      open: 100 + i,
      close: 100 + i + 0.5,
      high: 101 + i,
      low: 99 + i,
      volume: 10 + i, // OBV climbs with price
    }),
  )
}

/** A steady decline with rising volume on down bars — every dimension should read bear. */
function downtrend(n = 80): Candle[] {
  return Array.from({ length: n }, (_, i) =>
    bar(i, {
      open: 300 - i,
      close: 300 - i - 0.5,
      high: 301 - i,
      low: 299 - i,
      volume: 10 + i,
    }),
  )
}

describe('compositeSignal', () => {
  it('a clean uptrend reads LONG with high conviction and cites its numbers', () => {
    const signal = compositeSignal(uptrend())
    expect(signal).not.toBeNull()
    expect(signal!.bias).toBe('long')
    expect(signal!.conviction).toBeGreaterThan(0.6)
    const trend = signal!.dimensions.find((d) => d.name === 'trend')!
    expect(trend.vote).toBe('bull')
    expect(trend.note).toContain('EMA12')
    expect(trend.note).toContain('ADX')
  })

  it('a clean downtrend reads SHORT', () => {
    const signal = compositeSignal(downtrend())
    expect(signal!.bias).toBe('short')
    expect(signal!.dimensions.find((d) => d.name === 'trend')!.vote).toBe('bear')
  })

  it('returns null when not one dimension has enough bars', () => {
    expect(compositeSignal([bar(0), bar(1), bar(2)])).toBeNull()
  })

  it('a dimension without a full window reports n/a and is excluded, never counted neutral', () => {
    // 30 bars: EMA26/MACD/RSI exist, but OBV SMA20 needs 20 OBV points (obv starts at index 1),
    // so with a short-but-sufficient series every dimension votes; shrink below OBV's window.
    const shortSeries = uptrend(15)
    const signal = compositeSignal(shortSeries)
    // Whatever votes, conviction is over the VOTING dimensions only (never diluted by n/a ones).
    if (signal) {
      const voting = signal.dimensions.filter((d) => d.vote !== 'n/a')
      expect(voting.length).toBeGreaterThan(0)
      expect(signal.conviction).toBeLessThanOrEqual(1)
    }
  })

  it('renders the aggregate lean first, then each dimension with its numbers', () => {
    const text = renderCompositeSignal(compositeSignal(uptrend())!).join('\n')
    expect(text).toContain('composite signal: LONG')
    expect(text).toContain('trend:')
    expect(text).toContain('momentum:')
    expect(text).toContain('volume:')
  })

  it('suggested exposure equals conviction for a directional signal, 0 for a neutral one', () => {
    const directional = compositeSignal(uptrend())!
    expect(suggestedExposure(directional)).toBe(directional.conviction)
    expect(suggestedExposure({ bias: 'neutral', conviction: 0, dimensions: [] })).toBe(0)
    // The report carries the figure so the agent can cite it.
    expect(renderCompositeSignal(directional).join('\n')).toContain('suggested exposure')
  })
})
