import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { pairRead, renderPairRead } from './pair-read'

const series = (closes: number[], t0 = 0): Candle[] =>
  closes.map((close, i) => ({
    time: t0 + i * 3600,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }))

/** A wiggly base series long enough for the 60-bar lookback. */
const base = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1)

describe('pairRead', () => {
  it('a near-copy is a near-perfect pair; an EXACTLY constant ratio abstains (z undefined)', () => {
    // A perfectly scaled copy has a CONSTANT ratio — zero std, no z-score to claim: null.
    expect(pairRead(series(base), series(base.map((c) => c * 2)))).toBeNull()
    // Tiny independent wiggle on B: correlation/beta stay ≈ 1 and the z-score is definable.
    const noisy = base.map((c, i) => c * 2 * (1 + Math.sin(i * 7) * 0.001))
    const p = pairRead(series(base), series(noisy))!
    expect(p).not.toBeNull()
    expect(p.correlation).toBeGreaterThan(0.99)
    expect(p.beta).toBeCloseTo(1, 1)
    expect(p.state).toBe('near_mean')
  })

  it('A finishing on a spike reads stretched_rich; the mirror reads stretched_cheap', () => {
    const spiked = [...base]
    spiked[spiked.length - 1] = spiked.at(-1)! * 1.2 // A rips 20% on the last bar
    const rich = pairRead(series(spiked), series(base))!
    expect(rich.zScore).toBeGreaterThan(2)
    expect(rich.state).toBe('stretched_rich')
    const cheap = pairRead(series(base), series(spiked))!
    expect(cheap.state).toBe('stretched_cheap')
  })

  it('aligns by timestamp intersection — misaligned halves abstain', () => {
    // B's bars sit at offset times: zero intersection → null.
    expect(pairRead(series(base), series(base, 1800))).toBeNull()
    // Too few aligned bars → null.
    expect(pairRead(series(base.slice(0, 30)), series(base.slice(0, 30)))).toBeNull()
  })

  it('render warns when the correlation says this is barely a pair', () => {
    // Anti-correlated legs: A up-drift vs B down-drift with independent wiggle.
    const a = Array.from({ length: 80 }, (_, i) => 100 + i + Math.sin(i) * 2)
    const b = Array.from({ length: 80 }, (_, i) => 200 - i + Math.cos(i * 1.7) * 2)
    const p = pairRead(series(a), series(b))!
    const line = renderPairRead('A', 'B', p).join('\n')
    expect(Math.abs(p.correlation)).toBeLessThan(0.6)
    expect(line).toContain('barely a pair')
  })
})
