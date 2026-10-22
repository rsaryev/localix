import { describe, expect, test } from 'bun:test'
import { labelAnchor, nearestT, type PathProbe } from './edge-label'

/** An elbow: 100 across, then 100 down. */
const elbow: PathProbe = {
  length: 200,
  pointAt: (distance) =>
    distance <= 100 ? { x: distance, y: 0 } : { x: 100, y: Math.min(100, distance - 100) },
}

describe('edge captions', () => {
  test('sit above a run that goes across and beside one that goes down', () => {
    expect(labelAnchor(elbow, 0.25)).toEqual({ x: 50, y: 0, across: true })
    expect(labelAnchor(elbow, 0.75)).toEqual({ x: 100, y: 50, across: false })
  })

  test('a dragged caption lands on the nearest point of the line, clear of its ends', () => {
    expect(nearestT(elbow, { x: 102, y: 60 })).toBe(0.8)
    expect(nearestT(elbow, { x: -40, y: 0 })).toBe(0.08)
    expect(nearestT(elbow, { x: 100, y: 300 })).toBe(0.92)
  })
})
