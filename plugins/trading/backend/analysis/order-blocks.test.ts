import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { detectOrderBlocks, orderBlockDrawPayloads, renderOrderBlocks } from './order-blocks'

/** A bar with a controllable body; range = body ± 1 so ATR stays small and predictable. */
const bar = (i: number, open: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open,
  close,
  high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1,
  volume: 10,
})

/** A flat warm-up long enough for ATR(14), around `level`. */
const warmup = (n: number, level: number): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i, level, level + (i % 2 === 0 ? 1 : -1)))

describe('detectOrderBlocks', () => {
  it('finds the last down-candle before an up displacement as a bullish block', () => {
    const pre = warmup(20, 100)
    const n = pre.length
    // The block: a down candle 101→99, then an impulse that closes far above its high.
    const candles = [
      ...pre,
      bar(n, 101, 99), // the candidate (high 102, low 98)
      bar(n + 1, 99, 112), // displacement: close 112 ≥ 102 + 1.5×ATR (ATR ≈ 3)
      bar(n + 2, 112, 111),
      bar(n + 3, 111, 113),
    ]
    const blocks = detectOrderBlocks(candles)
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    const b = blocks.find((x) => x.direction === 'bullish')!
    expect(b).toBeDefined()
    expect(b.bottom).toBe(98)
    expect(b.top).toBe(102)
    expect(b.distancePct).toBeLessThan(0) // the zone sits BELOW price (negative, FVG convention)
  })

  it('a later close through the far side mitigates the block (dropped)', () => {
    const pre = warmup(20, 100)
    const n = pre.length
    const candles = [
      ...pre,
      bar(n, 101, 99),
      bar(n + 1, 99, 112),
      bar(n + 2, 112, 97), // closes below the block's low 98 → mitigated
      bar(n + 3, 97, 96),
    ]
    expect(detectOrderBlocks(candles).filter((b) => b.direction === 'bullish')).toHaveLength(0)
  })

  it('no displacement → no block; wick-only touch keeps it valid', () => {
    const pre = warmup(20, 100)
    const n = pre.length
    // Down candle followed by a mild drift — never 1.5×ATR beyond its high.
    const meandering = [...pre, bar(n, 101, 99), bar(n + 1, 99, 101), bar(n + 2, 101, 100)]
    expect(detectOrderBlocks(meandering)).toHaveLength(0)

    // With displacement, a later candle that only WICKS into the zone leaves it unmitigated.
    const wicked = [
      ...pre,
      bar(n, 101, 99),
      bar(n + 1, 99, 112),
      { ...bar(n + 2, 112, 110), low: 99 }, // wick into the zone, close well above
      bar(n + 3, 110, 111),
    ]
    expect(wicked && detectOrderBlocks(wicked).some((b) => b.direction === 'bullish')).toBe(true)
  })

  it('draw payloads are stable-id zones; render flags INSIDE first', () => {
    const blocks = [
      { direction: 'bullish' as const, top: 102, bottom: 98, mid: 100, time: 1, distancePct: 0 },
    ]
    const payloads = orderBlockDrawPayloads('c', 'BTC/USDT', blocks)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.drawing!.id).toBe('ob-1')
    expect(payloads[0]!.drawing!.kind).toBe('zone')
    const text = renderOrderBlocks(blocks).join('\n')
    expect(text).toContain('INSIDE a bullish order block NOW')
    expect(text).toContain('order blocks')
  })
})
