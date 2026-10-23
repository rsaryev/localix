import { describe, expect, it } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import { navigateTimeScale } from './useChartAgentCommands'

type Range = { from: number; to: number }

function fakeTimeScale(initial: Range | null) {
  const calls: string[] = []
  let range = initial
  return {
    calls,
    range: () => range,
    ts: {
      scrollToRealTime: () => void calls.push('realtime'),
      fitContent: () => void calls.push('fit'),
      getVisibleLogicalRange: () => range as never,
      setVisibleLogicalRange: (next: Range) => {
        calls.push('set')
        range = next
      },
    },
  }
}

const candles: Candle[] = Array.from({ length: 200 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
}))

describe('navigateTimeScale', () => {
  it('jumps to the live edge and fits without touching the range', () => {
    const fake = fakeTimeScale({ from: 0, to: 100 })
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'to_realtime' }, candles)
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'fit' }, candles)
    expect(fake.calls).toEqual(['realtime', 'fit'])
  })

  it('zooms in to a narrower span and out to a wider one', () => {
    const fake = fakeTimeScale({ from: 0, to: 100 })
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'zoom_in' }, candles)
    const zoomedIn = fake.range()!
    expect(zoomedIn.to - zoomedIn.from).toBeLessThan(100)
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'zoom_out' }, candles)
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'zoom_out' }, candles)
    const zoomedOut = fake.range()!
    expect(zoomedOut.to - zoomedOut.from).toBeGreaterThan(100)
  })

  it('centers the bar nearest the requested time, keeping the span', () => {
    const fake = fakeTimeScale({ from: 0, to: 40 })
    navigateTimeScale(
      fake.ts,
      { type: 'navigate', op: 'to_time', time: candles[120]!.time },
      candles,
    )
    const next = fake.range()!
    expect(next.to - next.from).toBeCloseTo(40)
    expect((next.from + next.to) / 2).toBeCloseTo(120, 0)
  })

  it('leaves an unzoomable chart alone', () => {
    const fake = fakeTimeScale(null)
    navigateTimeScale(fake.ts, { type: 'navigate', op: 'zoom_in' }, candles)
    expect(fake.calls).toEqual([])
  })
})
