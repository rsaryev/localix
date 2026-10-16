import { describe, expect, it } from 'bun:test'
import {
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_LEVELS,
  clampScale,
  nextZoomIn,
  nextZoomOut,
  zoomLabel,
} from './imageZoom'

describe('clampScale', () => {
  it('holds values inside the bounds', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(2.5)).toBe(2.5)
  })
  it('clamps below/above the bounds', () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE)
    expect(clampScale(999)).toBe(MAX_SCALE)
  })
})

describe('nextZoomIn', () => {
  it('advances to the next discrete stop', () => {
    expect(nextZoomIn(1)).toBe(1.5)
    expect(nextZoomIn(0.55)).toBe(0.6)
  })
  it('never exceeds MAX_SCALE', () => {
    expect(nextZoomIn(20)).toBe(MAX_SCALE)
    expect(nextZoomIn(50)).toBe(MAX_SCALE)
  })
  it('steps up from a between-stops value', () => {
    expect(nextZoomIn(1.2)).toBe(1.5)
  })
})

describe('nextZoomOut', () => {
  it('retreats to the previous discrete stop', () => {
    expect(nextZoomOut(1.5)).toBe(1)
    expect(nextZoomOut(0.65)).toBe(0.6)
  })
  it('never drops below MIN_SCALE', () => {
    expect(nextZoomOut(0.1)).toBe(MIN_SCALE)
    expect(nextZoomOut(0.05)).toBe(MIN_SCALE)
  })
  it('steps down from a between-stops value', () => {
    expect(nextZoomOut(1.2)).toBe(1)
  })
})

describe('in/out are inverse across a middle stop', () => {
  it('round-trips 1 → 1.5 → 1', () => {
    expect(nextZoomOut(nextZoomIn(1))).toBe(1)
  })
})

describe('zoomLabel', () => {
  it('labels fit and percentages', () => {
    expect(zoomLabel('fit')).toBe('Fit')
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(0.5)).toBe('50%')
    expect(zoomLabel(2)).toBe('200%')
  })
  it('rounds fractional percentages', () => {
    expect(zoomLabel(0.333)).toBe('33%')
  })
})

describe('ZOOM_LEVELS ladder', () => {
  it('is sorted ascending and spans 1x', () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1])
    }
    expect(ZOOM_LEVELS).toContain(1)
  })
})
