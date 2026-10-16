import { describe, expect, test } from 'bun:test'
import type { Candle } from '../../backend/contracts'
import { buffered } from './useOhlcv'

const bar = (time: number): Candle => ({ time, open: 1, high: 2, low: 0, close: 1, volume: 1 })

describe('buffered — bars held while the history request is in flight', () => {
  test('bars held for THIS target are released', () => {
    const held = [bar(1), bar(2)]
    expect(buffered({ target: 'c/BTC/3m', candles: held }, 'c/BTC/3m')).toBe(held)
  })

  test('bars held for the timeframe we just LEFT are dropped, never merged', () => {
    // A socket frame can outlive its subscription: the unsubscribe lives in an effect that runs
    // after paint, so an hourly bar can reach the callback of a chart that now asks for minutes.
    // Merging it would put an hour of price action inside a three-minute chart.
    expect(buffered({ target: 'c/BTC/1h', candles: [bar(1)] }, 'c/BTC/3m')).toEqual([])
  })

  test('a different symbol is a different target too', () => {
    expect(buffered({ target: 'c/ETH/3m', candles: [bar(1)] }, 'c/BTC/3m')).toEqual([])
  })

  test('a different connection is a different target too', () => {
    expect(buffered({ target: 'c2/BTC/3m', candles: [bar(1)] }, 'c1/BTC/3m')).toEqual([])
  })
})
