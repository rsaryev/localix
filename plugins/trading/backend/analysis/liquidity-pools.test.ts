import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { detectLiquidityPools, renderLiquidityPools } from './liquidity-pools'

const bar = (i: number, over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 10,
  ...over,
})

/** Two clean equal highs at 110 (swing span 3 on each side), price ends below them. */
function equalHighsTape(): Candle[] {
  const c: Candle[] = []
  let i = 0
  const flat = (n: number) => {
    for (let k = 0; k < n; k++) c.push(bar(i++))
  }
  const spike = (high: number) => c.push(bar(i++, { high }))
  flat(4)
  spike(110)
  flat(6)
  spike(110.05) // within 0.15% of 110 — "equal"
  flat(6)
  return c
}

describe('detectLiquidityPools', () => {
  it('clusters near-equal swing highs into a buy-side pool at the cluster extreme', () => {
    const found = detectLiquidityPools(equalHighsTape())
    const pool = found.find((p) => p.side === 'buy-side')!
    expect(pool).toBeDefined()
    expect(pool.touches).toBe(2)
    expect(pool.price).toBeCloseTo(110.05, 5)
    expect(pool.distancePct).toBeGreaterThan(0) // sits above price
    expect(pool.swept).toBe(false)
  })

  it('a recent wick through that closes back flags the pool JUST SWEPT', () => {
    const tape = equalHighsTape()
    tape.push(bar(tape.length, { high: 111, close: 100 })) // sweep: through 110.05, closed back
    const pool = detectLiquidityPools(tape).find((p) => p.side === 'buy-side')!
    expect(pool.swept).toBe(true)
    expect(renderLiquidityPools([pool]).join('\n')).toContain('LIQUIDITY SWEEP just printed')
  })

  it('a recent CLOSE beyond the level breaks the pool (dropped, stops are gone)', () => {
    const tape = equalHighsTape()
    tape.push(bar(tape.length, { high: 112, close: 111 })) // closed above → broken, not swept
    expect(detectLiquidityPools(tape).filter((p) => p.side === 'buy-side')).toHaveLength(0)
  })

  it('a single swing is not a pool (needs ≥2 equal extremes)', () => {
    const c: Candle[] = []
    for (let i = 0; i < 4; i++) c.push(bar(i))
    c.push(bar(4, { high: 110 }))
    for (let i = 5; i < 12; i++) c.push(bar(i))
    expect(detectLiquidityPools(c).filter((p) => p.side === 'buy-side')).toHaveLength(0)
  })
})
