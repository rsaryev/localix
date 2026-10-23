import { describe, expect, test } from 'bun:test'
import type { PrimitiveHoveredItem, SeriesAttachedParameter, Time } from 'lightweight-charts'
import { drawingHit, TrendlinePrimitive, VerticalLinePrimitive } from './drawingPrimitives'

/** A chart whose time and price axes are the identity, so coordinates are the drawing's values. */
const identityChart = {
  chart: { timeScale: () => ({ timeToCoordinate: (time: number) => time }) },
  series: { priceToCoordinate: (price: number) => price },
  requestUpdate: () => {},
} as unknown as SeriesAttachedParameter<Time>

const hovered = (id: string, distance: number): PrimitiveHoveredItem => ({
  externalId: `drawing:${id}`,
  zOrder: 'normal',
  distance,
  hitTestPriority: 1,
  cursorStyle: 'pointer',
})

describe('TrendlinePrimitive.hitTest', () => {
  const line = new TrendlinePrimitive({
    id: 't1',
    kind: 'trendline',
    time1: 0,
    price1: 0,
    time2: 100,
    price2: 0,
  })
  line.attached(identityChart)
  line.updateAllViews()

  test('a point within six pixels of the segment hovers it, with its distance', () => {
    expect(line.hitTest(50, 4)).toEqual(hovered('t1', 4))
    expect(line.hitTest(50, 6)).toEqual(hovered('t1', 6))
  })

  test('past the end the distance is to the endpoint, and beyond six pixels misses', () => {
    expect(line.hitTest(103, 4)).toEqual(hovered('t1', 5))
    expect(line.hitTest(50, 7)).toBeNull()
  })

  test('an unplaced line hits nothing', () => {
    const detached = new TrendlinePrimitive({
      id: 't2',
      kind: 'trendline',
      time1: 0,
      price1: 0,
      time2: 1,
      price2: 1,
    })
    expect(detached.hitTest(0, 0)).toBeNull()
  })
})

describe('VerticalLinePrimitive.hitTest', () => {
  const line = new VerticalLinePrimitive({ id: 'v1', kind: 'vline', time: 40 })
  line.attached(identityChart)
  line.updateAllViews()

  test('a point within six pixels of the line hovers it, with its distance', () => {
    expect(line.hitTest(37)).toEqual(hovered('v1', 3))
    expect(line.hitTest(46)).toEqual(hovered('v1', 6))
    expect(line.hitTest(47)).toBeNull()
  })
})

describe('drawingHit', () => {
  test('within six pixels is a pointer hover keyed by the drawing id', () => {
    expect(drawingHit('d1', 0)).toEqual(hovered('d1', 0))
    expect(drawingHit('d1', 6)).toEqual(hovered('d1', 6))
  })

  test('further than six pixels is no hover', () => {
    expect(drawingHit('d1', 6.01)).toBeNull()
  })
})
