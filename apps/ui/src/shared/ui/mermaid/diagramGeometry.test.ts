import { expect, test } from 'bun:test'
import { diagramBounds, diagramWindowSize } from './diagramGeometry'

test('uses viewBox dimensions rather than a responsive width or unrelated inner shapes', () => {
  expect(
    diagramBounds('<svg width="100%" viewBox="-8 -8 1600 64"><rect width="400" /></svg>'),
  ).toEqual({
    x: 0,
    y: 0,
    width: 1600,
    height: 64,
  })
  expect(diagramBounds("<svg viewBox='0,0,240,960'></svg>").height).toBe(960)
  expect(diagramBounds('<svg width="420px" height="200"></svg>').width).toBe(420)
  expect(diagramBounds('<svg width="100%" height="50%"></svg>').width).toBe(800)
  expect(diagramBounds('<svg viewBox="0 0 NaN -1"></svg>')).toEqual({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  })
})

test('horizontal chains stay shallow, small diagrams stay compact and tall diagrams have room', () => {
  expect(diagramWindowSize({ width: 1600, height: 64 })).toEqual({ width: 1320, height: 280 })
  expect(diagramWindowSize({ width: 240, height: 120 })).toEqual({ width: 560, height: 310 })
  expect(diagramWindowSize({ width: 400, height: 1400 })).toEqual({ width: 596, height: 760 })
})
