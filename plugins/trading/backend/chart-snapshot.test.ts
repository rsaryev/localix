import { describe, expect, it } from 'bun:test'

import { describeChartSnapshot, parseChartSnapshotResult } from './chart-snapshot'

const full = {
  mounted: true,
  connectionId: 'public:hyperliquid',
  symbol: 'BTC/USDC:USDC',
  timeframe: '4h',
  chartType: 'candles',
  indicators: ['ema:200', 'rsi:14'],
  visibleRange: { from: 1_700_000_000, to: 1_700_360_000 },
  lastCandle: { time: 1_700_360_000, close: 64_000 },
}

describe('parseChartSnapshotResult — the reply-side guard', () => {
  it('accepts a full snapshot and the minimal unmounted form', () => {
    expect(parseChartSnapshotResult(full)).toEqual(full as never)
    const minimal = { mounted: false, connectionId: 'c1', symbol: 'X/Y' }
    expect(parseChartSnapshotResult(minimal)).toEqual(minimal)
  })

  it('drops malformed replies instead of feeding the model garbage', () => {
    expect(parseChartSnapshotResult(null)).toBeNull()
    expect(parseChartSnapshotResult('ok')).toBeNull()
    expect(parseChartSnapshotResult({ connectionId: 'c', symbol: 's' })).toBeNull() // no mounted
    expect(parseChartSnapshotResult({ ...full, chartType: 'heikin' })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, indicators: [1] })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, visibleRange: { from: 'a', to: 2 } })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, lastCandle: { time: 1 } })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, scaleMode: 'sideways' })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, hiddenIndicators: [1] })).toBeNull()
    // A non-numeric plot value would print as garbage in the narration.
    expect(
      parseChartSnapshotResult({ ...full, indicatorValues: { 'rsi:14': { line: 'high' } } }),
    ).toBeNull()
    expect(
      parseChartSnapshotResult({ ...full, indicatorValues: { 'rsi:14': { line: 63.2 } } }),
    ).not.toBeNull()
  })
})

describe('describeChartSnapshot — the model-facing narration', () => {
  it('a mounted snapshot reads as live state with ISO times', () => {
    const text = describeChartSnapshot(full as never, 'hyperliquid (public market data)')
    expect(text).toContain('tab is open')
    expect(text).toContain('timeframe: 4h')
    expect(text).toContain('chart type: candles')
    // Each indicator gets its own line: label + the canonical id to command it with.
    expect(text).toContain('EMA 200 (ema:200)')
    expect(text).toContain('RSI 14 (rsi:14)')
    expect(text).toContain('2023-11-14T22:13:20.000Z') // visibleRange.from
    expect(text).toContain('close 64000')
  })

  it('COMPUTED values are the point of a snapshot — one plot reads =, several are named', () => {
    const text = describeChartSnapshot(
      {
        mounted: true,
        connectionId: 'c1',
        symbol: 'X/Y',
        indicators: ['rsi:14', 'macd:12:26:9', 'ema:200'],
        hiddenIndicators: ['ema:200'],
        indicatorValues: {
          'rsi:14': { line: 63.2481 },
          'macd:12:26:9': { macd: -12.44, signal: -9.1, histogram: -3.34 },
        },
        scaleMode: 'log',
      },
      'venue',
    )
    expect(text).toContain('RSI 14 (rsi:14) = 63.25')
    expect(text).toContain('macd=-12.44, signal=-9.1, histogram=-3.34')
    // A hidden indicator is still ON — saying otherwise would misread the chart.
    expect(text).toContain('EMA 200 (ema:200) — hidden')
    expect(text).toContain('price scale: log')
  })

  it('a linear scale is not narrated (it is the default reading of a chart)', () => {
    const text = describeChartSnapshot(
      { mounted: true, connectionId: 'c1', symbol: 'X/Y', indicators: [], scaleMode: 'linear' },
      'venue',
    )
    expect(text).not.toContain('price scale')
  })

  it('an unmounted snapshot is explicit that nothing is open and nothing was opened', () => {
    const text = describeChartSnapshot(
      { mounted: false, connectionId: 'c1', symbol: 'X/Y', chartType: 'candles', indicators: [] },
      'venue',
    )
    expect(text).toContain('NOT open')
    expect(text).toContain('nothing was opened')
    expect(text).toContain('indicators: none')
    expect(text).not.toContain('visible range')
  })
})

describe('snapshot drawings', () => {
  const withDrawings = {
    ...full,
    drawings: [
      { kind: 'hline', id: 'd1', price: 65_000, label: 'resistance' },
      {
        kind: 'trendline',
        id: 'd2',
        time1: 1_700_000_000,
        price1: 60_000,
        time2: 1_700_360_000,
        price2: 70_000,
      },
    ],
  }

  it('the guard accepts listed drawings and refuses malformed or id-less ones', () => {
    expect(parseChartSnapshotResult(withDrawings)).toEqual(withDrawings as never)
    expect(
      parseChartSnapshotResult({ ...full, drawings: [{ kind: 'hline', price: 1 }] }),
    ).toBeNull()
    expect(parseChartSnapshotResult({ ...full, drawings: [{ kind: 'blob', id: 'd1' }] })).toBeNull()
    expect(parseChartSnapshotResult({ ...full, drawings: 'd1' })).toBeNull()
  })

  it('the narration lists each drawing with its id', () => {
    const text = describeChartSnapshot(withDrawings as never, 'venue')
    expect(text).toContain('drawings: horizontal line @ 65000 ("resistance", id d1)')
    expect(text).toContain('id d2')
    // No drawings → no drawings line at all.
    expect(describeChartSnapshot(full as never, 'venue')).not.toContain('drawings:')
  })
})
