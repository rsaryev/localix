import { describe, expect, test } from 'bun:test'
import { describeChartDrawing, parseChartDrawingSpec, type ChartDrawingSpec } from './chart-drawing'

const T1 = 1_700_000_000
const T2 = 1_700_360_000

describe('parseChartDrawingSpec — the wire guard', () => {
  test('accepts each kind with only its required params', () => {
    expect(parseChartDrawingSpec({ kind: 'hline', price: 65_000 })).toEqual({
      kind: 'hline',
      price: 65_000,
    })
    const trend = { kind: 'trendline', time1: T1, price1: 60_000, time2: T2, price2: 70_000 }
    expect(parseChartDrawingSpec(trend)).toEqual(trend as ChartDrawingSpec)
    expect(parseChartDrawingSpec({ kind: 'vline', time: T1 })).toEqual({ kind: 'vline', time: T1 })
    expect(parseChartDrawingSpec({ kind: 'marker', time: T1, side: 'buy' })).toEqual({
      kind: 'marker',
      time: T1,
      side: 'buy',
    })
    // The recorded fill price is optional and rides through.
    const sell = { kind: 'marker', time: T1, side: 'sell', price: 64_250.5 }
    expect(parseChartDrawingSpec(sell)).toEqual(sell as ChartDrawingSpec)
    // A zone needs both band edges.
    const zone = { kind: 'zone', price1: 60_000, price2: 62_000 }
    expect(parseChartDrawingSpec(zone)).toEqual(zone as ChartDrawingSpec)
    expect(parseChartDrawingSpec({ kind: 'zone', price1: 60_000 })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'zone', price1: 60_000, price2: Number.NaN })).toBeNull()
  })

  test('marker rejects a missing/unknown side and a broken time or price', () => {
    expect(parseChartDrawingSpec({ kind: 'marker', time: T1 })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'marker', time: T1, side: 'long' })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'marker', side: 'buy' })).toBeNull()
    expect(
      parseChartDrawingSpec({ kind: 'marker', time: T1, side: 'buy', price: Number.NaN }),
    ).toBeNull()
  })

  test('carries the optional id / color / style / label through unchanged', () => {
    const d = {
      kind: 'hline',
      price: 1.23,
      id: 'resistance',
      color: '#ff9900',
      lineStyle: 'dashed',
      label: 'R1',
    }
    expect(parseChartDrawingSpec(d)).toEqual(d as ChartDrawingSpec)
  })

  test('rejects non-objects, unknown kinds and missing/broken params', () => {
    expect(parseChartDrawingSpec(null)).toBeNull()
    expect(parseChartDrawingSpec('hline')).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'circle', price: 1 })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'hline' })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'hline', price: Number.NaN })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'trendline', time1: T1, price1: 1, time2: T2 })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'vline', time: '2024' })).toBeNull()
  })

  test('rejects malformed optionals rather than carrying them to the chart', () => {
    expect(parseChartDrawingSpec({ kind: 'hline', price: 1, id: '' })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'hline', price: 1, lineStyle: 'wavy' })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'hline', price: 1, color: 7 })).toBeNull()
    expect(parseChartDrawingSpec({ kind: 'hline', price: 1, label: 9 })).toBeNull()
  })
})

describe('describeChartDrawing — the narration', () => {
  test('each kind reads as an act, with label/style/id as a suffix', () => {
    expect(describeChartDrawing({ kind: 'hline', price: 65_000 })).toBe('horizontal line @ 65000')
    expect(
      describeChartDrawing({
        kind: 'hline',
        price: 65_000,
        id: 'd1',
        label: 'resistance',
        lineStyle: 'dashed',
      }),
    ).toBe('horizontal line @ 65000 ("resistance", dashed, id d1)')
    expect(
      describeChartDrawing({
        kind: 'trendline',
        time1: T1,
        price1: 60_000,
        time2: T2,
        price2: 70_000,
      }),
    ).toBe('trendline 2023-11-14T22:13:20.000Z @ 60000 → 2023-11-19T02:13:20.000Z @ 70000')
    expect(describeChartDrawing({ kind: 'vline', time: T1, lineStyle: 'solid' })).toBe(
      'vertical line @ 2023-11-14T22:13:20.000Z',
    )
    expect(
      describeChartDrawing({
        kind: 'marker',
        time: T1,
        side: 'buy',
        price: 64_000,
        id: 'm1',
        label: 'entry',
      }),
    ).toBe('buy marker @ 2023-11-14T22:13:20.000Z @ 64000 ("entry", id m1)')
    expect(describeChartDrawing({ kind: 'marker', time: T1, side: 'sell' })).toBe(
      'sell marker @ 2023-11-14T22:13:20.000Z',
    )
    // A zone reads as its low–high band, edges in either order.
    expect(
      describeChartDrawing({ kind: 'zone', price1: 62_000, price2: 60_000, label: 'demand' }),
    ).toBe('zone 60000–62000 ("demand")')
  })
})
