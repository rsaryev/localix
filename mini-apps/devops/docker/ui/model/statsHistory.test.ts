import { describe, expect, test } from 'bun:test'
import type { ContainerStats } from '../../backend/contracts'
import {
  STATS_HISTORY_MAX,
  STATS_HISTORY_MS,
  appendStatSample,
  counterRate,
  seriesScale,
  sparklinePoints,
  statSampleOf,
  summarizeSeries,
  type StatSample,
} from './statsHistory'

const sample = (at: number, cpuPct = 1, memPct = 2): StatSample => ({
  at,
  cpuPct,
  memPct,
  netRxBytes: 0,
  netTxBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
})

const counting = (at: number, netRxBytes: number | null): StatSample => ({
  ...sample(at),
  netRxBytes,
})

const stats = (over: Partial<ContainerStats> = {}): ContainerStats => ({
  id: 'abc',
  cpuPct: 12.5,
  memPct: 3.5,
  memUsage: '12MiB / 2GiB',
  netIO: '1kB / 0B',
  blockIO: '0B / 0B',
  netRxBytes: 1_200,
  netTxBytes: 0,
  blockReadBytes: 0,
  blockWriteBytes: 0,
  pids: 7,
  ...over,
})

describe('appendStatSample', () => {
  test('keeps samples in poll order, oldest first', () => {
    const history = [sample(1_000), sample(2_000)]
    expect(appendStatSample(history, sample(3_000)).map((s) => s.at)).toEqual([1_000, 2_000, 3_000])
  })

  test('samples older than the window are dropped', () => {
    const history = [sample(1_000), sample(2_000)]
    const now = 1_000 + STATS_HISTORY_MS + 1
    expect(appendStatSample(history, sample(now), now).map((s) => s.at)).toEqual([2_000, now])
  })

  test('the cap holds regardless of poll cadence', () => {
    // Pruning by age alone retains far more samples than intended at a fast tick,
    // which is what this cap exists to stop.
    let history: StatSample[] = []
    for (let index = 0; index < STATS_HISTORY_MAX + 50; index += 1) {
      history = appendStatSample(history, sample(10_000 + index))
    }
    expect(history).toHaveLength(STATS_HISTORY_MAX)
    // The oldest survivors are dropped, not the newest.
    expect(history[history.length - 1]!.at).toBe(10_000 + STATS_HISTORY_MAX + 49)
  })

  test('the input history is never mutated', () => {
    const history = [sample(1_000)]
    appendStatSample(history, sample(2_000))
    expect(history).toHaveLength(1)
  })
})

describe('statSampleOf', () => {
  test('reads a poll result into a sample, cumulative counters included', () => {
    expect(statSampleOf(stats(), 5_000)).toEqual({
      at: 5_000,
      cpuPct: 12.5,
      memPct: 3.5,
      netRxBytes: 1_200,
      netTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
    })
  })

  test('an unreported counter stays null through the sample', () => {
    expect(statSampleOf(stats({ netRxBytes: null }), 1)?.netRxBytes).toBeNull()
  })
  test('a stopped container records nothing', () => {
    expect(statSampleOf(null, 5_000)).toBeNull()
  })
  test('an unparseable sample is skipped rather than poisoning the series', () => {
    // A NaN in the history would make every scale and average NaN from then on.
    expect(statSampleOf(stats({ cpuPct: Number.NaN }), 1)).toBeNull()
    expect(statSampleOf(stats({ memPct: Number.NaN }), 1)).toBeNull()
  })
})

describe('counterRate', () => {
  test('bytes per second from the two most recent samples', () => {
    const history = [counting(1_000, 0), counting(4_000, 3_000)]
    expect(counterRate(history, 'netRxBytes')).toBe(1_000)
  })

  test('only the latest interval counts, not the whole window average', () => {
    // The panel is answering "is it busy NOW"; averaging over five minutes would hide a
    // burst that started two seconds ago.
    const history = [counting(0, 0), counting(1_000, 10_000), counting(2_000, 10_000)]
    expect(counterRate(history, 'netRxBytes')).toBe(0)
  })

  test('a single sample cannot yield a rate', () => {
    expect(counterRate([counting(1_000, 500)], 'netRxBytes')).toBeNull()
  })

  test('a counter Docker never reported has no rate', () => {
    expect(counterRate([counting(1_000, null), counting(2_000, null)], 'netRxBytes')).toBeNull()
  })

  test('a counter that only just became available has no rate yet', () => {
    expect(counterRate([counting(1_000, null), counting(2_000, 500)], 'netRxBytes')).toBeNull()
  })

  test('a counter reset (container restarted) is unknown, not zero', () => {
    // Clamping a negative delta to 0 would claim idleness; averaging across the reset
    // would invent throughput that never happened.
    expect(counterRate([counting(1_000, 9_000), counting(2_000, 10)], 'netRxBytes')).toBeNull()
  })

  test('two samples with no time between them cannot divide', () => {
    expect(counterRate([counting(1_000, 0), counting(1_000, 500)], 'netRxBytes')).toBeNull()
  })
})

describe('summarizeSeries', () => {
  test('min/max/avg/last', () => {
    expect(summarizeSeries([2, 8, 5])).toEqual({ min: 2, max: 8, avg: 5, last: 5 })
  })
  test('an empty series has no summary rather than a zeroed one', () => {
    expect(summarizeSeries([])).toBeNull()
  })
})

describe('seriesScale', () => {
  test('a near-idle container is drawn against a 1% ceiling, not 100%', () => {
    // Against a fixed 100 this trace would be a flat line on the floor — the same shape
    // as "no data" — hiding the fact that usage tripled.
    expect(seriesScale([0.1, 0.2, 0.3])).toBe(1)
  })
  test('a busy series rounds up to a readable ceiling', () => {
    expect(seriesScale([12, 31, 22])).toBe(35)
    expect(seriesScale([96])).toBe(100)
  })
  test('CPU above 100% (multi-core) still scales', () => {
    // `docker stats` reports 380% for a container using nearly four cores.
    expect(seriesScale([120, 380])).toBe(400)
  })
  test('an empty series has a usable scale instead of dividing by zero', () => {
    expect(seriesScale([])).toBe(1)
  })
})

describe('sparklinePoints', () => {
  test('oldest sample on the left, high values near the top', () => {
    // scale 10 → 0 sits at y=height, 10 at y=0.
    expect(sparklinePoints([0, 5, 10], 100, 20, 10)).toBe('0,20 50,10 100,0')
  })

  test('one sample draws a flat segment, not an invisible point', () => {
    expect(sparklinePoints([5], 100, 20, 10)).toBe('0,10 100,10')
  })

  test('no samples draw nothing', () => {
    expect(sparklinePoints([], 100, 20)).toBe('')
  })

  test('values beyond the scale are clamped into the box', () => {
    expect(sparklinePoints([20, -5], 100, 20, 10)).toBe('0,0 100,20')
  })

  test('a zero scale cannot produce NaN geometry', () => {
    expect(sparklinePoints([0, 0], 100, 20, 0)).toBe('0,20 100,20')
  })
})
