import { describe, expect, test } from 'bun:test'
import { EDGE_CAPS, edgeCap } from './edge-caps'

const tip = { x: 100, y: 50 }

describe('line caps', () => {
  test('no cap draws nothing and leaves the line to its end', () => {
    expect(edgeCap('none', tip, 'left', 5)).toBeNull()
  })

  test('a filled cap stops the line in front of itself; an open one lets it reach the tip', () => {
    // Into a left handle the line travels +x, so "in front" is smaller x.
    expect(edgeCap('triangle', tip, 'left', 5)?.lineEnd.x).toBeLessThan(tip.x)
    expect(edgeCap('circle', tip, 'left', 5)?.lineEnd.x).toBeLessThan(tip.x)
    expect(edgeCap('diamond', tip, 'left', 5)?.lineEnd).toEqual({ x: 90, y: 50 })
    expect(edgeCap('arrow', tip, 'left', 5)?.lineEnd).toEqual(tip)
    expect(edgeCap('bar', tip, 'left', 5)?.lineEnd).toEqual(tip)
  })

  test('filled caps are painted, open ones stroked', () => {
    const filled = EDGE_CAPS.filter((kind) => edgeCap(kind, tip, 'top', 5)?.filled)
    expect(filled).toEqual(['triangle', 'circle', 'diamond'])
  })

  test('a bar lies across the line, whichever side it enters', () => {
    expect(edgeCap('bar', tip, 'left', 5)?.path).toBe('M 100 55 L 100 45')
    expect(edgeCap('bar', tip, 'top', 5)?.path).toBe('M 95 50 L 105 50')
  })
})
