import { describe, expect, test } from 'bun:test'
import { SHAPE_KINDS } from '../../shared/types/drawing'
import { shapePath } from './shape-path'

describe('shape outlines', () => {
  test('every kind the schema accepts has an outline', () => {
    for (const kind of SHAPE_KINDS) expect(shapePath(kind, 160, 100)).toMatch(/^M /u)
  })

  test('an outline stays inside its box, inset for the stroke', () => {
    for (const kind of SHAPE_KINDS) {
      const numbers = shapePath(kind, 160, 100, 2)
        .replace(/[a-zA-Z]/gu, ' ')
        .trim()
        .split(/\s+/u)
        .map(Number)
      // Absolute commands only for the polygon kinds; the arc kinds use relative offsets.
      if (['ellipse', 'cylinder', 'rounded', 'document'].includes(kind)) continue
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(2)
      expect(Math.max(...numbers)).toBeLessThanOrEqual(158)
    }
  })

  test('a diamond touches the middle of each side', () => {
    expect(shapePath('diamond', 100, 60, 0)).toBe('M 50 0 L 100 30 L 50 60 L 0 30 Z')
  })

  test('a cloud has one closed silhouette, without interior ellipse rings', () => {
    const path = shapePath('cloud', 160, 100, 2)
    expect(path.match(/M /gu)).toHaveLength(1)
    expect(path).toEndWith(' Z')
    expect(path).not.toMatch(/[aA]/u)
  })
})
