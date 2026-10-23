import { describe, expect, test } from 'bun:test'
import { rangeAroundTime, zoomedRange } from './chartNav'

describe('zoomedRange', () => {
  test('zoom in halves the span around the center; zoom out doubles it', () => {
    expect(zoomedRange({ from: 0, to: 100 }, 0.5)).toEqual({ from: 25, to: 75 })
    expect(zoomedRange({ from: 25, to: 75 }, 2)).toEqual({ from: 0, to: 100 })
  })

  test('the center never moves', () => {
    const zoomed = zoomedRange({ from: 10, to: 50 }, 0.5)
    expect((zoomed.from + zoomed.to) / 2).toBe(30)
  })

  test('zooming in bottoms out at a readable span instead of collapsing to a point', () => {
    let range = { from: 0, to: 100 }
    for (let i = 0; i < 20; i++) range = zoomedRange(range, 0.5)
    expect(range.to - range.from).toBe(5)
  })

  test('a degenerate (inverted) range is treated as empty, not amplified', () => {
    const r = zoomedRange({ from: 50, to: 40 }, 2)
    expect(r.to - r.from).toBe(5) // the minimum span, centered where the caller was
  })
})

describe('rangeAroundTime', () => {
  const candles = [1000, 1060, 1120, 1180, 1240].map((time) => ({ time }))

  test('centers the bar nearest the requested time, keeping the span', () => {
    // 1130 is nearest bar index 2 (1120); span 6 → from -1 to 5, centered on 2.
    expect(rangeAroundTime(candles, 1130, 6)).toEqual({ from: -1, to: 5 })
  })

  test('a time beyond either edge clamps to the nearest END bar', () => {
    expect(rangeAroundTime(candles, 0, 6)).toEqual({ from: -3, to: 3 })
    expect(rangeAroundTime(candles, 99_999, 6)).toEqual({ from: 1, to: 7 })
  })

  test('no history means nothing to aim at', () => {
    expect(rangeAroundTime([], 1000, 10)).toBeNull()
  })

  test('a tiny current span is widened to the readable minimum', () => {
    const r = rangeAroundTime(candles, 1120, 1)!
    expect(r.to - r.from).toBe(5)
  })
})
