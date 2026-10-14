import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { concentrationWarnings, renderConcentration } from './portfolio-concentration'

const series = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    time: i * 3600,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }))

const wave = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1)
const correlated = wave.map((c, i) => c * 2 * (1 + Math.sin(i * 7) * 0.001)) // ≈ the same returns
const independent = Array.from({ length: 80 }, (_, i) => 50 + Math.cos(i / 1.3) * 4)

describe('concentrationWarnings', () => {
  const candles = new Map([
    ['BTC/USDC:USDC', series(wave)],
    ['ETH/USDC:USDC', series(correlated)],
    ['DOGE/USDC:USDC', series(independent)],
    ['ETH/USDT:USDT', series(correlated)], // same returns as ETH, different quote
  ])

  it('same-direction, same-quote correlated legs warn as one sized position, worst book first', () => {
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 10_000 },
        { symbol: 'ETH/USDC:USDC', side: 'long', notional: 5_000 },
        { symbol: 'DOGE/USDC:USDC', side: 'long', notional: 1_000 },
      ],
      candles,
    )
    expect(w).toHaveLength(1) // DOGE is independent — no false concentration
    expect(w[0]).toMatchObject({ kind: 'adds_up', combinedNotional: 15_000, quote: 'USDC' })
    const text = renderConcentration(w).join('\n')
    expect(text).toContain('ONE ~15000 USDC position')
    expect(text).toContain('drawdown hits both legs at once')
  })

  it('opposite-direction correlated legs read as an intentional-hedge note, not concentration', () => {
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 10_000 },
        { symbol: 'ETH/USDC:USDC', side: 'short', notional: 5_000 },
      ],
      candles,
    )
    expect(w[0]?.kind).toBe('offsetting_hedge')
    expect(renderConcentration(w).join('\n')).toContain('caps both legs')
  })

  it('a cross-quote correlated pair still warns but never fabricates a summed size', () => {
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 10_000 },
        { symbol: 'ETH/USDT:USDT', side: 'long', notional: 5_000 },
      ],
      candles,
    )
    expect(w).toHaveLength(1)
    expect(w[0]?.quote).toBeUndefined() // no shared quote → no combined figure
    const text = renderConcentration(w).join('\n')
    expect(text).toContain('different quote currencies')
    expect(text).not.toContain('ONE ~') // the summed-position phrasing is suppressed
  })

  it('a same-quote pair outranks a cross-quote pair it does not truly exceed', () => {
    // Cross-quote legs 9000+9000 (ranked by the larger 9000) must sit BELOW a same-quote
    // 10000+5000=15000 book, not above it on a bogus 18000 raw sum.
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 10_000 },
        { symbol: 'ETH/USDC:USDC', side: 'long', notional: 5_000 },
        { symbol: 'ETH/USDT:USDT', side: 'long', notional: 9_000 },
      ],
      candles,
    )
    // Every correlated pair among the three ETH/BTC legs appears; the same-quote 15000 book ranks first.
    expect(w[0]?.quote).toBe('USDC')
    expect(w[0]?.combinedNotional).toBe(15_000)
  })

  it('two legs on the SAME instrument are not a correlated pair — never a self-hedge story', () => {
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 10_000 },
        { symbol: 'BTC/USDC:USDC', side: 'short', notional: 8_000 },
      ],
      candles,
    )
    expect(w).toEqual([])
  })

  it('missing candles or too few aligned bars stay silent — no claim without evidence', () => {
    const w = concentrationWarnings(
      [
        { symbol: 'BTC/USDC:USDC', side: 'long', notional: 1 },
        { symbol: 'UNKNOWN/USDC:USDC', side: 'long', notional: 1 },
      ],
      candles,
    )
    expect(w).toHaveLength(0)
    expect(renderConcentration([])).toEqual([])
  })
})
