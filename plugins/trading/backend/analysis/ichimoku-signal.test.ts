import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { ICHIMOKU_WARMUP, ichimokuSignal, renderIchimokuSignal } from './ichimoku-signal'

const bar = (i: number, level: number, spread = 1): Candle => ({
  time: 1_700_000_000 + i * 3600,
  open: level,
  close: level,
  high: level + spread,
  low: level - spread,
  volume: 10,
})

/** A long base at `base`, then a ramp of `rampBars` rising `step` per bar — the ramp drags the
 *  fast tenkan above the slow kijun (a bullish TK cross) with price far above the old cloud. */
function crossTape(base: number, rampBars: number, step: number): Candle[] {
  const out: Candle[] = []
  let i = 0
  for (; i < ICHIMOKU_WARMUP + 10; i++) out.push(bar(i, base))
  for (let k = 1; k <= rampBars; k++) out.push(bar(i++, base + k * step))
  return out
}

describe('ichimokuSignal', () => {
  it('reports nothing below the 78-bar warm-up or without a recent cross', () => {
    expect(ichimokuSignal(crossTape(100, 12, 5).slice(0, 40))).toBeNull()
    // A dead-flat tape has tenkan == kijun forever — no cross ever prints.
    expect(ichimokuSignal(Array.from({ length: 120 }, (_, i) => bar(i, 100)))).toBeNull()
  })

  it('a fresh ramp prints a bullish TK cross; the young cloud gates it to stand aside or long', () => {
    const s = ichimokuSignal(crossTape(100, 12, 5))!
    expect(s).not.toBeNull()
    expect(s.cross).toBe('bullish')
    expect(s.barsAgo).toBeLessThan(5)
    expect(s.tenkan).toBeGreaterThan(s.kijun)
    // Twelve ramp bars in, the displaced cloud is still the flat base — price sits above it, but
    // the cloud itself is flat (span A == span B, not bullish), so the gate says stand aside.
    expect(s.priceVsCloud).toBe('above')
    expect(s.verdict).toBe('stand_aside')
    expect(s.failed.join(' ')).toContain('cloud is bearish')
  })

  it('the mirrored dump prints a bearish cross', () => {
    const s = ichimokuSignal(crossTape(100, 12, -5))!
    expect(s.cross).toBe('bearish')
    expect(s.priceVsCloud).toBe('below')
  })

  it('render names the verdict, the filters and the chikou state', () => {
    const s = ichimokuSignal(crossTape(100, 12, 5))!
    const line = renderIchimokuSignal(s).join('\n')
    expect(line).toContain('ichimoku')
    expect(line).toContain('STAND ASIDE')
    expect(line).toContain('tenkan')
    expect(line).toContain('chikou')
  })
})
