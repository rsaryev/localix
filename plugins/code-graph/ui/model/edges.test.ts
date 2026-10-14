import { describe, expect, test } from 'bun:test'
import type { GraphView, ViewNode } from '../../shared/view'
import { visibleEdges } from './edges'

const group = (id: string): ViewNode => ({
  id,
  kind: 'directory',
  name: id,
  path: id,
  parent: 'dir:.',
  dependents: 0,
  dependencies: 0,
  size: 1,
  role: 'child',
})

const view: GraphView = {
  scope: group('dir:.'),
  breadcrumb: [],
  nodes: [
    group('dir:a'),
    group('dir:b'),
    { ...group('file:a/one.ts'), kind: 'file', role: 'tile', group: 'dir:a' },
    { ...group('file:a/two.ts'), kind: 'file', role: 'tile', group: 'dir:a' },
    { ...group('file:b/one.ts'), kind: 'file', role: 'tile', group: 'dir:b' },
  ],
  edges: [
    { source: 'file:a/one.ts', target: 'file:b/one.ts', count: 4, kinds: { calls: 3, imports: 1 } },
    { source: 'file:a/two.ts', target: 'file:b/one.ts', count: 2, kinds: { calls: 2 } },
    { source: 'file:a/one.ts', target: 'file:a/two.ts', count: 1, kinds: { calls: 1 } },
  ],
  truncated: 0,
}

describe('edge drawing plan', () => {
  test('summarizes cross-container connections but keeps internal edges for a focused group', () => {
    const overview = visibleEdges(view, new Set(['calls']), null)
    expect(overview.edges.map((edge) => [edge.source, edge.target, edge.count])).toEqual([
      ['dir:a', 'dir:b', 5],
    ])
    expect(visibleEdges(view, new Set(['calls']), 'dir:a').edges).toHaveLength(3)
    expect(visibleEdges(view, new Set(['imports']), 'file:a/two.ts').edges).toEqual([])
  })

  test('caps the overview per group so a hub does not fill the canvas with lines', () => {
    const hub: GraphView = {
      ...view,
      nodes: [group('dir:hub'), ...Array.from({ length: 20 }, (_, i) => group(`dir:${i}`))],
      edges: Array.from({ length: 20 }, (_, i) => ({
        source: 'dir:hub',
        target: `dir:${i}`,
        count: 20 - i,
        kinds: { calls: 20 - i },
      })),
    }
    const drawn = visibleEdges(hub, new Set(['calls']), null)
    expect(drawn.total).toBe(20)
    expect(drawn.edges).toHaveLength(6)
    expect(drawn.edges[0]?.target).toBe('dir:0')
  })
})
