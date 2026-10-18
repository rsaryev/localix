import { describe, expect, test } from 'bun:test'
import {
  correctHubness,
  standoutGate,
  decodeVector,
  encodeVector,
  fromHalfBits,
  isFiniteVector,
  MIN_POPULATION,
  scoreRows,
  standardize,
  toHalfBits,
  truncateNormalize,
} from './vectors'

describe('float16 codec', () => {
  test('round-trips normalized components within half precision', () => {
    const v = truncateNormalize(
      Array.from({ length: 256 }, (_, i) => Math.sin(i + 1)),
      256,
    )
    const back = decodeVector(encodeVector(v), 256)
    for (let i = 0; i < v.length; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(5e-4)
  })

  test('encodes the edge values exactly', () => {
    for (const value of [0, 1, -1, 0.5, 2 ** -24, 65504]) {
      expect(fromHalfBits(toHalfBits(value))).toBe(value)
    }
    expect(fromHalfBits(toHalfBits(1e9))).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(fromHalfBits(toHalfBits(Number.NaN)))).toBe(true)
  })

  test('refuses a blob of the wrong width rather than reading garbage', () => {
    expect(() => decodeVector(new Uint8Array(10), 8)).toThrow('expected 16')
  })
})

describe('truncateNormalize', () => {
  test('keeps the leading components at unit length', () => {
    const v = truncateNormalize([3, 4, 12], 2)
    expect([...v]).toEqual([0.6000000238418579, 0.800000011920929])
  })

  test('isFiniteVector rejects NaN and empty vectors', () => {
    expect(isFiniteVector([0.1, Number.NaN])).toBe(false)
    expect(isFiniteVector([])).toBe(false)
    expect(isFiniteVector([0.1, 0.2])).toBe(true)
  })
})

describe('standardize', () => {
  test('a population puts a standout several deviations above the rest', () => {
    const scores = new Float32Array(MIN_POPULATION + 10).map((_, i) => 0.6 + (i % 5) * 0.005)
    scores[3] = 0.82
    const z = standardize(scores)
    expect(z[3]!).toBeGreaterThan(4)
    expect(Math.max(...[...z].filter((_, i) => i !== 3))).toBeLessThan(2)
  })

  test('a tiny collection uses the fixed scale instead of its own spread', () => {
    // Two near-identical unrelated items must not become "standouts" against each other.
    const z = standardize(new Float32Array([0.64, 0.66]))
    expect(z[1]!).toBeLessThan(1)
  })

  test('scoreRows is the dot product of each row', () => {
    const matrix = new Float32Array([1, 0, 0, 1, 0.6, 0.8])
    expect([...scoreRows(matrix, 3, 2, new Float32Array([1, 0]))]).toEqual([
      1, 0, 0.6000000238418579,
    ])
  })
})

describe('standoutGate', () => {
  test('grows with the population where the top of the noise grows, within [2, 3]', () => {
    expect(standoutGate(10)).toBe(2)
    expect(standoutGate(134)).toBeCloseTo(2.63, 2)
    expect(standoutGate(100_000)).toBe(3)
  })
})

describe('correctHubness', () => {
  test('penalizes items close to the centroid and never lifts the far ones', () => {
    const cosines = new Float32Array([0.7, 0.7, 0.7])
    correctHubness(cosines, new Float32Array([0.8, 0.6, 0.7]))
    expect(cosines[0]!).toBeCloseTo(0.6)
    expect(cosines[1]!).toBeCloseTo(0.7)
    expect(cosines[2]!).toBeCloseTo(0.7)
  })
})
