import { describe, expect, test } from 'bun:test'
import type { GraphView } from '../../shared/view'
import { openingViewport } from './camera'
import type { Layout } from './layout'

const view = { nodes: [], edges: [] } as unknown as GraphView
const size = { width: 1000, height: 700 }

describe('opening camera', () => {
  test('fits compact levels, never past 100%', () => {
    const layout: Layout = {
      boxes: new Map([['a', { x: 0, y: 0, width: 300, height: 200 }]]),
      tiles: new Map(),
    }
    const viewport = openingViewport(view, layout, size)
    expect(viewport.zoom).toBe(1)
    expect(viewport.x + 150 * viewport.zoom).toBe(500)
    expect(viewport.y + 100 * viewport.zoom).toBe(350)
  })

  test('opens wide levels at reading scale rather than fitting unreadable dots', () => {
    const layout: Layout = {
      boxes: new Map([
        ['a', { x: 0, y: 0, width: 200, height: 100 }],
        ['b', { x: 5000, y: 0, width: 200, height: 100 }],
      ]),
      tiles: new Map(),
    }
    const viewport = openingViewport(view, layout, size)
    expect(viewport.zoom).toBe(0.72)
    expect(viewport.x + 2600 * viewport.zoom).toBe(500)
    const returning = openingViewport(view, layout, size, 'b')
    expect(returning.x + 5100 * returning.zoom).toBe(500)
  })
})
