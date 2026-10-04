import { describe, expect, it } from 'bun:test'
import { contextRingGeometry } from './context-ring'

describe('contextRingGeometry', () => {
  const radius = 9
  const circumference = 2 * Math.PI * radius

  it('returns the full circumference for the dasharray', () => {
    expect(contextRingGeometry(0.5, radius).circumference).toBeCloseTo(circumference)
  })

  it('offsets by the full circumference at 0 (empty ring)', () => {
    expect(contextRingGeometry(0, radius).dashOffset).toBeCloseTo(circumference)
  })

  it('offsets by zero at full (complete ring)', () => {
    expect(contextRingGeometry(1, radius).dashOffset).toBeCloseTo(0)
  })

  it('offsets by half the circumference at 50%', () => {
    expect(contextRingGeometry(0.5, radius).dashOffset).toBeCloseTo(circumference / 2)
  })

  it('clamps fractions below 0 to an empty ring', () => {
    expect(contextRingGeometry(-1, radius).dashOffset).toBeCloseTo(circumference)
  })

  it('clamps fractions above 1 to a full ring', () => {
    expect(contextRingGeometry(2, radius).dashOffset).toBeCloseTo(0)
  })
})
