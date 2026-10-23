import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { renderVolatility, volatilityReadout } from './volatility'

const bar = (i: number, over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...over,
})

/** A steady series with a fixed true range of `range` around price `price`. */
function steady(n: number, price: number, range: number): Candle[] {
  return Array.from({ length: n }, (_, i) =>
    bar(i, { open: price, close: price, high: price + range / 2, low: price - range / 2 }),
  )
}

describe('volatilityReadout', () => {
  it('reports ATR, its percent of price, and stop references', () => {
    const v = volatilityReadout(steady(40, 100, 4))
    expect(v).not.toBeNull()
    expect(v!.atr).toBeGreaterThan(0)
    expect(v!.atrPct).toBeCloseTo((v!.atr / 100) * 100, 5)
    expect(v!.halfAtr).toBeCloseTo(v!.atr * 0.5, 5)
    expect(v!.oneAtr).toBe(v!.atr)
  })

  it('flat volatility reads as stable', () => {
    expect(volatilityReadout(steady(60, 100, 4))!.trend).toBe('stable')
  })

  it('a widening range recently reads as expanding', () => {
    const calm = steady(30, 100, 2)
    const wild = Array.from({ length: 20 }, (_, i) =>
      bar(30 + i, { open: 100, close: 100, high: 108, low: 92 }),
    )
    expect(volatilityReadout([...calm, ...wild])!.trend).toBe('expanding')
  })

  it('returns null on too few bars for a full ATR window', () => {
    expect(volatilityReadout([bar(0), bar(1), bar(2)])).toBeNull()
  })

  it('renders the figure, percent, trend and stop references', () => {
    const text = renderVolatility(volatilityReadout(steady(40, 100, 4))!).join('\n')
    expect(text).toContain('ATR(14)')
    expect(text).toContain('% of price')
    expect(text).toContain('0.5×ATR')
    expect(text).toContain('1×ATR')
  })
})
