import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import {
  computeTechnicalRatings,
  sortRatingRows,
  verdictOf,
  type RatingRow,
} from './technicalRatings'

const bar = (time: number, close: number): Candle => ({
  time,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 10,
})

const bars = (...closes: number[]) => closes.map((c, i) => bar(i * 3600, c))

describe('verdictOf', () => {
  test('maps scores onto the published gauge bands', () => {
    expect(verdictOf(null)).toBe('neutral')
    expect(verdictOf(0)).toBe('neutral')
    expect(verdictOf(0.2)).toBe('buy')
    expect(verdictOf(0.6)).toBe('strong_buy')
    expect(verdictOf(-0.2)).toBe('sell')
    expect(verdictOf(-0.6)).toBe('strong_sell')
  })

  // Neutral is the CLOSED interval [−0.1, 0.1] and buy/sell open above/below it; the band edges
  // belong to the calmer verdict, so a rating that has barely tipped does not read as a call.
  test('the band edges themselves are the calmer verdict', () => {
    expect(verdictOf(0.1)).toBe('neutral')
    expect(verdictOf(-0.1)).toBe('neutral')
    expect(verdictOf(0.5)).toBe('buy')
    expect(verdictOf(-0.5)).toBe('sell')
    expect(verdictOf(0.5 + 1e-9)).toBe('strong_buy')
    expect(verdictOf(-0.5 - 1e-9)).toBe('strong_sell')
  })
})

describe('computeTechnicalRatings', () => {
  test('null below the minimum window', () => {
    expect(computeTechnicalRatings(bars(100, 101))).toBeNull()
  })

  test('a long steady uptrend rates buy-side on the MA table', () => {
    // 250 rising bars cover every MA warm-up; price sits above all of them.
    const r = computeTechnicalRatings(bars(...Array.from({ length: 250 }, (_, i) => 100 + i)))!
    expect(r.movingAverages.buys).toBeGreaterThan(r.movingAverages.sells)
    expect(['buy', 'strong_buy']).toContain(r.movingAverages.verdict)
    // Every MA row computed over this window (no null value among the classic periods).
    for (const row of r.movingAverages.rows) expect(row.value).not.toBeNull()
    // And the pooled summary carries all rows.
    expect(r.summary.rows.length).toBe(r.oscillators.rows.length + r.movingAverages.rows.length)
  })

  test('the mirror downtrend rates sell-side on the MA table', () => {
    const r = computeTechnicalRatings(bars(...Array.from({ length: 250 }, (_, i) => 400 - i)))!
    expect(r.movingAverages.sells).toBeGreaterThan(r.movingAverages.buys)
    expect(['sell', 'strong_sell']).toContain(r.movingAverages.verdict)
  })

  test('a short window abstains (null) on the long-warm-up rows instead of inventing values', () => {
    const r = computeTechnicalRatings(bars(...Array.from({ length: 30 }, (_, i) => 100 + i)))!
    const sma200 = r.movingAverages.rows.find((x) => x.name === 'Simple Moving Average (200)')!
    expect(sma200.value).toBeNull()
    expect(sma200.action).toBeNull()
    // Null rows don't dilute the score: the group only counts rows that voted.
    const voted = r.movingAverages.buys + r.movingAverages.sells + r.movingAverages.neutrals
    expect(voted).toBeLessThan(r.movingAverages.rows.length)
  })

  test('the eleven-oscillator table is present with values cited', () => {
    const r = computeTechnicalRatings(bars(...Array.from({ length: 250 }, (_, i) => 100 + i)))!
    expect(r.oscillators.rows).toHaveLength(11)
    const rsiRow = r.oscillators.rows.find((x) => x.name.startsWith('Relative Strength'))!
    expect(rsiRow.value).not.toBeNull()
  })

  test('summary score is the MEAN of the two group scores, not the pooled-row vote', () => {
    const r = computeTechnicalRatings(bars(...Array.from({ length: 250 }, (_, i) => 100 + i)))!
    expect(r.summary.score).toBeCloseTo((r.oscillators.score! + r.movingAverages.score!) / 2, 10)
    expect(r.summary.verdict).toBe(verdictOf(r.summary.score))
    // Counts stay the literal pooled tallies.
    expect(r.summary.rows.length).toBe(r.oscillators.rows.length + r.movingAverages.rows.length)
  })
})

describe('sortRatingRows', () => {
  const rows: RatingRow[] = [
    { name: 'a', value: 1, action: 'sell' },
    { name: 'b', value: 1, action: null },
    { name: 'c', value: 1, action: 'buy' },
    { name: 'd', value: 1, action: 'neutral' },
    { name: 'e', value: 1, action: 'buy' },
  ]

  test('standard keeps the canonical order', () => {
    expect(sortRatingRows(rows, 'standard').map((r) => r.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('signal groups buy → neutral → sell → non-voting, stable within bands', () => {
    expect(sortRatingRows(rows, 'signal').map((r) => r.name)).toEqual(['c', 'e', 'd', 'a', 'b'])
  })
})
