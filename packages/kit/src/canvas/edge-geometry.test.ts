import { describe, expect, test } from 'bun:test'
import { arrowHead, edgeWeight, floatingEnds } from './edge-geometry'

describe('arrowhead', () => {
  test('into a left handle: the line stops short on the left, the tip at the handle', () => {
    const head = arrowHead({ x: 100, y: 50 }, 'left', 5)
    expect(head.lineEnd).toEqual({ x: 95, y: 50 })
    expect(head.path).toBe('M 94 53.5 L 100 50 L 94 46.5 Z')
  })

  test('into a top handle: the head points down, the line stops above it', () => {
    const head = arrowHead({ x: 100, y: 50 }, 'top', 5)
    expect(head.lineEnd).toEqual({ x: 100, y: 45 })
    expect(head.path).toContain('L 100 50')
    // Both base corners sit above the tip, spread across it horizontally.
    expect(head.path).toBe('M 96.5 44 L 100 50 L 103.5 44 Z')
  })

  test('into a right handle mirrors the left one', () => {
    expect(arrowHead({ x: 100, y: 50 }, 'right', 5).lineEnd).toEqual({ x: 105, y: 50 })
  })
})

describe('floating ends', () => {
  const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height })

  test('each end attaches to the middle of the side facing the other node', () => {
    expect(floatingEnds(box(0, 0), box(300, 0))).toEqual({
      source: { x: 100, y: 25, side: 'right' },
      target: { x: 300, y: 25, side: 'left' },
    })
    expect(floatingEnds(box(0, 0), box(0, 300)).source.side).toBe('bottom')
  })

  test('the side is judged against the node’s proportions, not raw distance', () => {
    // A wide card 120px right and 80px below: sideways is less than one width, down is more
    // than one height — the connector leaves through the bottom.
    expect(floatingEnds(box(0, 0, 400, 50), box(120, 130, 400, 50)).source.side).toBe('bottom')
  })

  test('a pinned side wins over the facing one', () => {
    expect(floatingEnds(box(0, 0), box(300, 0), { source: 'top' }).source).toEqual({
      x: 50,
      y: 0,
      side: 'top',
    })
  })
})

describe('edge weight', () => {
  test('one relation is a hairline, many grow slowly and cap', () => {
    expect(edgeWeight(1)).toBeCloseTo(1.4)
    expect(edgeWeight(1000)).toBe(3.5)
    expect(edgeWeight(3)).toBeLessThan(edgeWeight(30))
  })
})
