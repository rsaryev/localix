import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import {
  classifyCandleUpdate,
  movingAverage,
  toVolumeData,
  upsertBar,
  upsertCandles,
} from './candleSeries'

const bar = (time: number, close: number, open = close, volume = 1): Candle => ({
  time,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume,
})

describe('toVolumeData', () => {
  test('colors up bars vs down bars', () => {
    const data = toVolumeData([bar(1, 105, 100), bar(2, 95, 100)], { up: 'U', down: 'D' })
    expect(data[0]?.color).toBe('U') // close ≥ open
    expect(data[1]?.color).toBe('D') // close < open
    expect(data[0]?.value).toBe(1)
  })

  test('a bar the venue reported no volume for draws NO column', () => {
    // A zero-height column and an unreported volume look identical on screen, and only one of them
    // means nothing traded in that bar.
    const undated: Candle = { time: 3, open: 1, high: 1, low: 1, close: 1 }
    const data = toVolumeData([bar(1, 105, 100), undated], { up: 'U', down: 'D' })
    expect(data.map((d) => d.time)).toEqual([1] as never)
  })

  test('a REPORTED zero-volume bar still draws its column', () => {
    const data = toVolumeData([bar(1, 105, 100, 0)], { up: 'U', down: 'D' })
    expect(data).toHaveLength(1)
    expect(data[0]?.value).toBe(0)
  })
})

describe('upsertBar', () => {
  test('appends a newer bar', () => {
    const s = [bar(1, 10)]
    const next = upsertBar(s, bar(2, 11))
    expect(next.map((c) => c.time)).toEqual([1, 2])
  })
  test('replaces the in-progress (same-time) bar', () => {
    const s = [bar(1, 10), bar(2, 11)]
    const next = upsertBar(s, bar(2, 12))
    expect(next.at(-1)?.close).toBe(12)
    expect(next).toHaveLength(2)
  })
  test('keeps the same reference on a byte-identical replace', () => {
    const s = [bar(2, 11)]
    expect(upsertBar(s, bar(2, 11))).toBe(s)
  })
  test('an older bar is a CORRECTION, not a stale tick', () => {
    // A venue finalises a closed bar with the trades that landed in its last moments — after the
    // next bar has already opened. Dropping it froze the chart's history at a half-formed candle.
    const s = [bar(1, 10), bar(2, 11)]
    const next = upsertBar(s, bar(1, 99))
    expect(next.map((c) => c.close)).toEqual([99, 11])
  })
  test('a bar in a gap is inserted in ascending order', () => {
    const next = upsertBar([bar(1, 10), bar(3, 12)], bar(2, 11))
    expect(next.map((c) => c.time)).toEqual([1, 2, 3])
  })
  test('an unchanged older bar keeps the same reference', () => {
    const s = [bar(1, 10), bar(2, 11)]
    expect(upsertBar(s, bar(1, 10))).toBe(s)
  })
  test('appends onto an empty series', () => {
    expect(upsertBar([], bar(1, 10))).toHaveLength(1)
  })
})

describe('upsertCandles', () => {
  test('folds a batch (append + replace)', () => {
    const s = [bar(1, 10), bar(2, 11)]
    const next = upsertCandles(s, [bar(2, 12), bar(3, 13)])
    expect(next.map((c) => [c.time, c.close])).toEqual([
      [1, 10],
      [2, 12],
      [3, 13],
    ])
  })

  test('a whole backfill page prepends in one merge', () => {
    const held = [bar(10, 1), bar(11, 2)]
    const page = [bar(7, 7), bar(8, 8), bar(9, 9)]
    expect(upsertCandles(held, page).map((c) => c.time)).toEqual([7, 8, 9, 10, 11])
  })

  test('a batch that changes nothing returns the SAME array reference', () => {
    const held = [bar(1, 10), bar(2, 11)]
    expect(upsertCandles(held, [bar(1, 10), bar(2, 11)])).toBe(held)
    // …and an untouched existing bar keeps its object identity after a partial merge.
    const next = upsertCandles(held, [bar(2, 12)])
    expect(next[0]).toBe(held[0]!)
  })

  test('an unordered batch with a duplicate time: later occurrence wins (the old reduce semantics)', () => {
    const next = upsertCandles([bar(1, 10)], [bar(3, 30), bar(2, 20), bar(2, 21)])
    expect(next.map((c) => [c.time, c.close])).toEqual([
      [1, 10],
      [2, 21],
      [3, 30],
    ])
  })

  test('fills a gap in place, preserving ascending order', () => {
    const next = upsertCandles([bar(1, 10), bar(3, 30)], [bar(2, 20), bar(4, 40)])
    expect(next.map((c) => c.time)).toEqual([1, 2, 3, 4])
  })
})

describe('classifyCandleUpdate', () => {
  const history = [bar(1, 10), bar(2, 20), bar(3, 30)]

  test('an identical array (or two empties) is `none`', () => {
    expect(classifyCandleUpdate(history, [...history]).kind).toBe('none')
    expect(classifyCandleUpdate([], []).kind).toBe('none')
  })

  test('only the last bar moving is a `tick`', () => {
    const next = [bar(1, 10), bar(2, 20), bar(3, 31)]
    expect(classifyCandleUpdate(history, next)).toEqual({ kind: 'tick', bar: next[2]! })
  })

  test('one new bar with an untouched tail is an `append` without a correction', () => {
    const next = [...history, bar(4, 40)]
    expect(classifyCandleUpdate(history, next)).toEqual({
      kind: 'append',
      bar: next[3]!,
      corrected: null,
    })
  })

  test('a rollover that also finalises the closed bar is an `append` carrying the correction', () => {
    // The venue lands the closed bar's final close/volume AFTER the next bar opens — both must
    // reach the series through `update()`, closed bar first.
    const next = [bar(1, 10), bar(2, 20), bar(3, 32), bar(4, 40)]
    expect(classifyCandleUpdate(history, next)).toEqual({
      kind: 'append',
      bar: next[3]!,
      corrected: next[2]!,
    })
  })

  test('anything `update()` cannot express is a `reset`', () => {
    // Initial load.
    expect(classifyCandleUpdate([], history).kind).toBe('reset')
    // A prepend (backfill) shifts the prefix.
    expect(classifyCandleUpdate(history, [bar(0, 5), ...history]).kind).toBe('reset')
    // A deep correction touches a non-tail bar.
    expect(classifyCandleUpdate(history, [bar(1, 11), bar(2, 20), bar(3, 30)]).kind).toBe('reset')
    // A shrink (target switch mid-flight).
    expect(classifyCandleUpdate(history, history.slice(0, 2)).kind).toBe('reset')
    // More than one appended bar.
    expect(classifyCandleUpdate(history, [...history, bar(4, 40), bar(5, 50)]).kind).toBe('reset')
  })

  test('a volume-less venue still ticks incrementally (volume must not gate the fast path)', () => {
    const noVol = (time: number, close: number): Candle => ({
      time,
      open: close,
      high: close,
      low: close,
      close,
    })
    const held = [noVol(1, 10), noVol(2, 20)]
    expect(classifyCandleUpdate(held, [noVol(1, 10), noVol(2, 21)]).kind).toBe('tick')
    expect(classifyCandleUpdate(held, [...held, noVol(3, 30)]).kind).toBe('append')
  })
})

describe('movingAverage', () => {
  const bars = [bar(1, 10), bar(2, 20), bar(3, 30), bar(4, 40), bar(5, 50)]

  test('emits the rolling mean once `period` closes exist, keyed by bar time', () => {
    // 3-period SMA: (10+20+30)/3=20 at t3, (20+30+40)/3=30 at t4, (30+40+50)/3=40 at t5.
    expect(movingAverage(bars, 3).map((p) => [Number(p.time), p.value])).toEqual([
      [3, 20],
      [4, 30],
      [5, 40],
    ])
  })

  test('draws no warped head — the first point is `period − 1` bars in, not a partial average', () => {
    const line = movingAverage(bars, 3)
    expect(Number(line[0]!.time)).toBe(3)
    expect(line).toHaveLength(3)
  })

  test('period 1 is just the closes', () => {
    expect(
      movingAverage([bar(1, 10), bar(2, 12)], 1).map((p) => [Number(p.time), p.value]),
    ).toEqual([
      [1, 10],
      [2, 12],
    ])
  })

  test('too few bars, or a non-positive period, yields []', () => {
    expect(movingAverage([bar(1, 10), bar(2, 20)], 3)).toEqual([])
    expect(movingAverage(bars, 0)).toEqual([])
    expect(movingAverage([], 3)).toEqual([])
  })
})
