import { describe, expect, test } from 'bun:test'
import { quantizeBoundaryStart, DEFAULT_BOUNDARY_QUANTUM } from './boundary'

describe('quantizeBoundaryStart', () => {
  test('floors the start index DOWN to a multiple of the quantum', () => {
    expect(quantizeBoundaryStart(0, 8)).toBe(0)
    expect(quantizeBoundaryStart(7, 8)).toBe(0)
    expect(quantizeBoundaryStart(8, 8)).toBe(8)
    expect(quantizeBoundaryStart(15, 8)).toBe(8)
    expect(quantizeBoundaryStart(16, 8)).toBe(16)
  })

  test('never moves the boundary forward (quantized <= start) — protects MORE, never fewer', () => {
    for (let s = 0; s < 50; s++) {
      const q = quantizeBoundaryStart(s, 8)
      expect(q).toBeLessThanOrEqual(s)
      expect(q % 8).toBe(0)
    }
  })

  test('is monotonic non-decreasing as start advances (never steps backward)', () => {
    let prev = -1
    for (let s = 0; s < 50; s++) {
      const q = quantizeBoundaryStart(s, 8)
      expect(q).toBeGreaterThanOrEqual(prev)
      prev = q
    }
  })

  test('quantum <= 1 disables quantization (clamped to >= 0)', () => {
    expect(quantizeBoundaryStart(13, 1)).toBe(13)
    expect(quantizeBoundaryStart(13, 0)).toBe(13)
    expect(quantizeBoundaryStart(-5, 1)).toBe(0)
  })

  test('non-finite quantum falls back to the clamped start', () => {
    expect(quantizeBoundaryStart(13, Number.NaN)).toBe(13)
    expect(quantizeBoundaryStart(13, Infinity)).toBe(13)
  })

  test('negative start never yields a negative boundary', () => {
    expect(quantizeBoundaryStart(-3, 8)).toBe(0)
  })

  test('defaults to DEFAULT_BOUNDARY_QUANTUM when omitted', () => {
    expect(quantizeBoundaryStart(20)).toBe(
      Math.floor(20 / DEFAULT_BOUNDARY_QUANTUM) * DEFAULT_BOUNDARY_QUANTUM,
    )
  })
})
