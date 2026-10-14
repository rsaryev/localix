import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import {
  alternatingSwings,
  detectHarmonicPattern,
  renderHarmonicPattern,
} from './harmonic-patterns'

/** A zigzag tape: linear legs between the given turning prices, `legBars` bars per leg. The
 *  turn bars poke 0.01 beyond the leg line so pivots(span=3) sees strict extrema. */
function zigzag(points: number[], legBars = 7): Candle[] {
  const out: Candle[] = []
  let t = 0
  const push = (level: number, extreme?: 'high' | 'low') => {
    out.push({
      time: 1_700_000_000 + t++ * 3600,
      open: level,
      close: level,
      high: level + (extreme === 'high' ? 0.4 : 0.1),
      low: level - (extreme === 'low' ? 0.4 : 0.1),
      volume: 10,
    })
  }
  for (let leg = 0; leg + 1 < points.length; leg++) {
    const from = points[leg]!
    const to = points[leg + 1]!
    for (let k = leg === 0 ? 0 : 1; k <= legBars; k++) {
      const level = from + ((to - from) * k) / legBars
      const atTurn = k === legBars
      push(level, atTurn ? (to > from ? 'high' : 'low') : undefined)
    }
  }
  // A short settle after D so the last turn can register as a pivot (span bars each side).
  const last = points.at(-1)!
  for (let k = 0; k < 4; k++) push(last + (last > points.at(-2)! ? -0.15 : 0.15) * (k + 1))
  return out
}

describe('detectHarmonicPattern', () => {
  // Bullish Gartley: X 100 (low), A 110, B = A − 0.618·XA = 103.82, C 107.5, D = A − 0.786·XA.
  const gartley = [104, 100, 110, 103.82, 107.5, 102.14] // approach leg first — X needs bars both sides

  it('classifies a clean bullish Gartley with its ratios cited', () => {
    const h = detectHarmonicPattern(zigzag(gartley))!
    expect(h).not.toBeNull()
    expect(h.pattern).toBe('gartley')
    expect(h.direction).toBe('bullish')
    expect(h.bRatio).toBeCloseTo(0.618, 1)
    expect(h.dRatio).toBeCloseTo(0.786, 1)
    const line = renderHarmonicPattern(h).join('\n')
    expect(line).toContain('bullish GARTLEY')
    expect(line).toContain('Potential Reversal Zone')
  })

  it('the mirrored shape reads as a bearish pattern', () => {
    const h = detectHarmonicPattern(zigzag([106, 110, 100, 106.18, 102.5, 107.86]))!
    expect(h).not.toBeNull()
    expect(h.direction).toBe('bearish')
  })

  it('ratios outside every table row match nothing', () => {
    // B at 0.2 of XA fits no pattern's B column.
    expect(detectHarmonicPattern(zigzag([104, 100, 110, 108, 109.5, 102]))).toBeNull()
  })

  it('a stale D (long tail after completion) is history, not a live PRZ', () => {
    const tape = zigzag(gartley)
    for (let k = 0; k < 15; k++) {
      tape.push({
        ...tape.at(-1)!,
        time: tape.at(-1)!.time + 3600,
        high: tape.at(-1)!.close + 0.1,
        low: tape.at(-1)!.close - 0.1,
      })
    }
    expect(detectHarmonicPattern(tape)).toBeNull()
  })

  it('alternatingSwings produces a strictly alternating chain', () => {
    const swings = alternatingSwings(zigzag(gartley))
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i]!.kind).not.toBe(swings[i - 1]!.kind)
    }
  })
})
