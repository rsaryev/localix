import { describe, expect, test } from 'bun:test'
import {
  boundsOf,
  CAMERA_ZOOM,
  CAMERA_MOTION,
  fitViewport,
  pacedDuration,
  readableViewport,
  snappedZoom,
  stepZoom,
  zoomAt,
  type CameraViewport,
} from './camera'

describe('a camera move under reduced motion', () => {
  test('lands at once; otherwise keeps its pace', () => {
    expect(pacedDuration(CAMERA_MOTION.fit, true)).toBe(0)
    expect(pacedDuration(undefined, true)).toBe(0)
    expect(pacedDuration(CAMERA_MOTION.fit, false)).toBe(CAMERA_MOTION.fit)
    expect(pacedDuration(undefined, false)).toBeUndefined()
  })
})

describe('a zoom gesture coming to rest', () => {
  test('settles at 100 % when it rests close to it, and is left alone otherwise', () => {
    expect(snappedZoom(0.96)).toBe(1)
    expect(snappedZoom(1.05)).toBe(1)
    expect(snappedZoom(1)).toBeNull()
    expect(snappedZoom(0.85)).toBeNull()
    expect(snappedZoom(1.2)).toBeNull()
  })
})

const VIEW = { width: 1000, height: 700 }

/** Where a world point lands on screen under a viewport. */
const onScreen = (viewport: CameraViewport, x: number, y: number) => ({
  x: x * viewport.zoom + viewport.x,
  y: y * viewport.zoom + viewport.y,
})

describe('zoom steps', () => {
  test('land on round percentages and return to 100% from either side', () => {
    expect(stepZoom(0.83, 1)).toBe(1)
    expect(stepZoom(1.2, -1)).toBe(1)
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.75)
  })

  test('a step closer than half its gap is skipped, so a press always visibly moves', () => {
    // 0.98 → 1 is 0.02 of a 0.25 gap: skipped.
    expect(stepZoom(0.98, 1)).toBe(1.25)
    expect(stepZoom(0.9999, 1)).toBe(1.25)
    expect(stepZoom(1.0001, -1)).toBe(0.75)
    // 0.8 → 1 is more than half the gap: taken.
    expect(stepZoom(0.8, 1)).toBe(1)
  })

  test('stop at the canvas limits, skipping steps outside them', () => {
    expect(stepZoom(2.5, 1)).toBe(CAMERA_ZOOM.max)
    expect(stepZoom(2.3, 1)).toBe(2.5)
    expect(stepZoom(0.1, -1)).toBe(CAMERA_ZOOM.min)
    expect(stepZoom(1, 1, { min: 0.5, max: 1.1 })).toBe(1.1)
  })
})

describe('zoom about a point', () => {
  test('keeps the world point under the anchor where it was', () => {
    const before = { x: 40, y: -30, zoom: 0.8 }
    const anchor = { x: 300, y: 200 }
    const world = { x: (anchor.x - before.x) / before.zoom, y: (anchor.y - before.y) / before.zoom }
    const after = zoomAt(before, anchor, 2)
    expect(after.zoom).toBe(2)
    expect(onScreen(after, world.x, world.y).x).toBeCloseTo(anchor.x)
    expect(onScreen(after, world.x, world.y).y).toBeCloseTo(anchor.y)
  })

  test('clamps to the limits, still about the anchor', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 99).zoom).toBe(CAMERA_ZOOM.max)
  })
})

describe('fitting', () => {
  test('bounds of nothing is nothing', () => {
    expect(boundsOf([])).toBeNull()
  })

  test('a fit centres the bounds and never enlarges past 100%', () => {
    const bounds = { x: 0, y: 0, width: 300, height: 200 }
    const viewport = fitViewport(bounds, VIEW)
    expect(viewport.zoom).toBe(1)
    expect(onScreen(viewport, 150, 100)).toEqual({ x: 500, y: 350 })
    expect(fitViewport(bounds, VIEW, { maxZoom: 2 }).zoom).toBe(2)
  })

  test('a compact content opens fitted', () => {
    const viewport = readableViewport({ x: 0, y: 0, width: 300, height: 200 }, VIEW)
    expect(viewport.zoom).toBe(1)
  })

  test('a wide content opens at reading scale on its anchor, not as unreadable dots', () => {
    const bounds = boundsOf([
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 5000, y: 0, width: 200, height: 100 },
    ])
    if (!bounds) throw new Error('bounds')
    const centred = readableViewport(bounds, VIEW)
    expect(centred.zoom).toBe(0.72)
    expect(onScreen(centred, 2600, 50).x).toBeCloseTo(500)
    const anchored = readableViewport(bounds, VIEW, { anchor: { x: 5100, y: 50 } })
    expect(onScreen(anchored, 5100, 50).x).toBeCloseTo(500)
  })
})
