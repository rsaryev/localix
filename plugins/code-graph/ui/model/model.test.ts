import { describe, expect, test } from 'bun:test'
import type { GraphView, ViewNode } from '../../shared/view'
import { countOf, GROUP_TYPE, toFlow } from './flow'
import { layoutKey, layoutView, TILE } from './layout'
import { levelFor } from './navigation'

function node(id: string, extra: Partial<ViewNode> = {}): ViewNode {
  return {
    id,
    kind: 'directory',
    name: id,
    path: id.slice(4),
    parent: 'dir:.',
    dependents: 0,
    dependencies: 0,
    size: 1,
    role: 'child',
    ...extra,
  }
}

const tile = (id: string, group: string) =>
  node(id, { kind: 'file', role: 'tile', group, parent: group })

// `api` and `db` are containers with tiles; `cli` is a plain box; `lib` is a portal.
const view: GraphView = {
  scope: { ...node('dir:.'), parent: null },
  breadcrumb: [{ id: 'dir:.', name: 'demo' }],
  nodes: [
    node('dir:api', { hiddenTiles: 3 }),
    tile('file:api/a.ts', 'dir:api'),
    tile('file:api/b.ts', 'dir:api'),
    node('dir:db'),
    tile('file:db/q.ts', 'dir:db'),
    node('dir:cli', { kind: 'file' }),
    node('dir:lib', { role: 'portal' }),
  ],
  edges: [
    { source: 'file:api/a.ts', target: 'file:db/q.ts', count: 3, kinds: { imports: 1, calls: 2 } },
    { source: 'dir:cli', target: 'file:api/b.ts', count: 1, kinds: { calls: 1 } },
    { source: 'file:db/q.ts', target: 'dir:lib', count: 1, kinds: { imports: 1 } },
  ],
  truncated: 0,
}

describe('layout', () => {
  test('tiles sit inside their container, and containers are laid out by lifted edges', () => {
    const { boxes, tiles } = layoutView(view)
    expect([...boxes.keys()].sort()).toEqual(['dir:api', 'dir:cli', 'dir:db', 'dir:lib'])
    expect([...tiles.keys()].sort()).toEqual(['file:api/a.ts', 'file:api/b.ts', 'file:db/q.ts'])
    // cli → api → db → lib reads left to right.
    const x = (id: string) => boxes.get(id)?.x ?? 0
    expect(
      x('dir:cli') < x('dir:api') && x('dir:api') < x('dir:db') && x('dir:db') < x('dir:lib'),
    ).toBe(true)
    // A container fits its tiles, plus the "+N more" line when some are not drawn.
    const api = boxes.get('dir:api')
    const lastTile = tiles.get('file:api/b.ts')
    expect((api?.height ?? 0) > (lastTile?.y ?? 0) + TILE.height).toBe(true)
  })

  test('boxes with no edges are packed apart, never stacked on one spot', () => {
    const loose: GraphView = {
      ...view,
      nodes: ['a', 'b', 'c', 'd'].map((name) => node(`file:${name}.ts`, { kind: 'file' })),
      edges: [],
    }
    const { boxes } = layoutView(loose)
    const spots = new Set([...boxes.values()].map((box) => `${box.x},${box.y}`))
    expect(spots.size).toBe(4)
  })

  test('the layout key ignores counts that do not move boxes', () => {
    const recounted = { ...view, nodes: view.nodes.map((n) => ({ ...n, dependents: 99 })) }
    expect(layoutKey(recounted)).toBe(layoutKey(view))
    expect(layoutKey({ ...view, edges: view.edges.slice(1) })).not.toBe(layoutKey(view))
  })
})

describe('overlay', () => {
  test('containers precede their tiles, which are placed relative to them', () => {
    const { nodes } = toFlow(view, layoutView(view), {
      focus: null,
      highlighted: new Set(),
      kinds: new Set(['calls', 'imports']),
    })
    const index = (id: string) => nodes.findIndex((n) => n.id === id)
    expect(index('dir:api')).toBeLessThan(index('file:api/a.ts'))
    expect(nodes.find((n) => n.id === 'dir:api')?.type).toBe(GROUP_TYPE)
    expect(nodes.find((n) => n.id === 'file:api/a.ts')?.parentId).toBe('dir:api')
    expect(nodes.find((n) => n.id === 'dir:api')?.zIndex).toBeGreaterThan(0)
  })

  test('focus lights its connections and dims the rest; filters drop edges', () => {
    const { nodes, edges } = toFlow(view, layoutView(view), {
      focus: 'file:api/a.ts',
      highlighted: new Set(['dir:lib']),
      kinds: new Set(['calls']),
    })
    const emphasis = Object.fromEntries(nodes.map((n) => [n.id, n.data.emphasis]))
    expect(emphasis['file:api/a.ts']).toBe('focus')
    expect(emphasis['file:db/q.ts']).toBe('neighbor')
    expect(emphasis['dir:api']).toBe('idle')
    expect(emphasis['dir:cli']).toBe('dimmed')
    expect(nodes.find((n) => n.id === 'dir:lib')?.data.highlighted).toBe(true)
    // Focus draws only this tile's calls: the unrelated line into api stays off the canvas.
    expect(edges.map((e) => `${e.source}>${e.target}`)).toEqual(['file:api/a.ts>file:db/q.ts'])
    // The visible relation is lit, drawn by the board's own edge (no type) and labelled with the
    // filtered count.
    expect(edges.map((e) => [e.type, e.data?.emphasis, e.data?.label])).toEqual([
      [undefined, 'focus', '2'],
    ])
  })

  test('edge weight counts only the enabled kinds', () => {
    expect(countOf({ imports: 1, calls: 2 }, new Set(['calls']))).toBe(2)
  })

  test('a node removed by refresh falls back to the grouped overview', () => {
    const drawing = toFlow(view, layoutView(view), {
      focus: 'file:deleted.ts',
      highlighted: new Set(),
      kinds: new Set(['calls', 'imports']),
    })
    expect(drawing.focused).toBe(false)
    expect(drawing.edges.length).toBeGreaterThan(0)
  })
})

describe('navigation', () => {
  test('a node is seen from the level that draws it as a box', () => {
    expect(levelFor({ id: 'dir:a/b', kind: 'directory', path: 'a/b', parent: 'dir:a' })).toBe(
      'dir:a',
    )
    expect(levelFor({ id: 'file:a/x.ts', kind: 'file', path: 'a/x.ts', parent: 'dir:a' })).toBe(
      'dir:a',
    )
    expect(
      levelFor({ id: 'sym:a/x.ts#f', kind: 'function', path: 'a/x.ts', parent: 'file:a/x.ts' }),
    ).toBe('file:a/x.ts')
    expect(levelFor({ id: 'pkg:react', kind: 'package', path: '', parent: null })).toBeNull()
  })
})
