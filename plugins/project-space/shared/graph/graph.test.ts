import { describe, expect, test } from 'bun:test'
import { describeSpace } from '../agent/describe'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import type { SpaceOp } from '../ops/contract'
import { spaceTypes } from '../types'
import { arrowOf, directionOf, linksOf } from './links'
import { elementName } from './names'
import { neighbourhood, reach, reachCounts } from './reach'
import { searchElements } from './search'

const boardOf = (ops: SpaceOp[]) => applyOps(emptySpace(), ops, { registry: spaceTypes }).space

// web → api → db, api → cache, and a return db → api drawn with its head reversed.
const flow = boardOf([
  { op: 'create', type: 'note', id: 'web', x: 0, y: 0, text: 'Web app' },
  { op: 'create', type: 'note', id: 'api', x: 300, y: 0, text: 'API server' },
  { op: 'create', type: 'note', id: 'db', x: 600, y: 0, text: 'Postgres' },
  { op: 'create', type: 'note', id: 'cache', x: 300, y: 300, text: 'Redis cache' },
  {
    op: 'create',
    type: 'file',
    id: 'route',
    x: 0,
    y: 300,
    props: { path: 'backend/api/routes.ts' },
  },
  { op: 'connect', id: 'e1', from: 'web', to: 'api', label: 'calls' },
  { op: 'connect', id: 'e2', from: 'api', to: 'db' },
  { op: 'connect', id: 'e3', from: 'api', to: 'cache' },
])

describe('which way a connector runs', () => {
  test('is read from the caps the person sees, not from `from`/`to`', () => {
    expect(directionOf({})).toBe('forward')
    expect(directionOf({ start: 'triangle', end: 'none' })).toBe('backward')
    expect(directionOf({ start: 'arrow', end: 'triangle' })).toBe('both')
    expect(directionOf({ start: 'none', end: 'none' })).toBe('both')
  })

  test('the roster prints the same arrow the trace follows', () => {
    const reversed = boardOf([
      { op: 'create', type: 'note', id: 'a', x: 0, y: 0 },
      { op: 'create', type: 'note', id: 'b', x: 300, y: 0 },
      { op: 'connect', id: 'ab', from: 'a', to: 'b' },
      { op: 'edge', id: 'ab', start: 'triangle', end: 'none' },
    ])
    expect(arrowOf(reversed.edges.ab!)).toBe('←')
    expect(describeSpace(reversed, spaceTypes)).toContain('[ab] a ← b')
    // Reversed on screen, so b leads to a.
    expect([...reach(reversed, 'b', 'downstream').elements.keys()]).toEqual(['b', 'a'])
    expect(reach(reversed, 'a', 'downstream').elements.size).toBe(1)
  })

  test('a connector to an element that is not on the board joins nothing', () => {
    const dangling = { ...flow, edges: { ...flow.edges, gone: { from: 'web', to: 'ghost' } } }
    expect(
      linksOf(dangling)
        .get('web')
        ?.map((link) => link.edge),
    ).toEqual(['e1'])
  })
})

describe('what an element touches and leads to', () => {
  test('its neighbourhood is its connectors and their other ends', () => {
    const near = neighbourhood(flow, 'api')
    expect([...near.elements.keys()].sort()).toEqual(['api', 'cache', 'db', 'web'])
    expect([...near.edges].sort()).toEqual(['e1', 'e2', 'e3'])
    expect(neighbourhood(flow, 'route')).toEqual({
      elements: new Map([['route', 0]]),
      edges: new Set(),
      hops: 0,
    })
  })

  test('downstream follows the arrows out, with each element at its nearest depth', () => {
    const down = reach(flow, 'web', 'downstream')
    expect(down.elements).toEqual(
      new Map([
        ['web', 0],
        ['api', 1],
        ['db', 2],
        ['cache', 2],
      ]),
    )
    expect(down.hops).toBe(2)
    expect(reach(flow, 'db', 'upstream').elements.get('web')).toBe(2)
  })

  test('a cycle is walked once and a two-way line is followed both ways', () => {
    const loop = applyOps(flow, [{ op: 'connect', id: 'back', from: 'db', to: 'web' }], {
      registry: spaceTypes,
    }).space
    const down = reach(loop, 'web', 'downstream')
    expect(down.elements.size).toBe(4)
    expect(down.edges.has('back')).toBe(true)
    const twoWay = applyOps(flow, [{ op: 'edge', id: 'e3', start: 'triangle' }], {
      registry: spaceTypes,
    }).space
    expect(reach(twoWay, 'cache', 'downstream').elements.has('db')).toBe(true)
  })

  test('the counts leave the origin out', () => {
    expect(reachCounts(flow, 'api')).toEqual({ upstream: 1, downstream: 2 })
    expect(reachCounts(flow, 'route')).toEqual({ upstream: 0, downstream: 0 })
  })
})

describe('finding an element', () => {
  test('every word, in any order, anywhere in its text, type or id', () => {
    expect(searchElements(flow, spaceTypes, 'api route').map((found) => found.id)).toEqual([
      'route',
    ])
    expect(searchElements(flow, spaceTypes, 'redis').map((found) => found.id)).toEqual(['cache'])
    expect(searchElements(flow, spaceTypes, 'file').map((found) => found.id)).toEqual(['route'])
    expect(searchElements(flow, spaceTypes, 'nothing here')).toEqual([])
  })

  test('a match at the start ranks before one inside a word', () => {
    const board = boardOf([
      { op: 'create', type: 'note', id: 'a', x: 0, y: 0, text: 'Reads the cache' },
      { op: 'create', type: 'note', id: 'b', x: 0, y: 300, text: 'Cache warmer' },
    ])
    expect(searchElements(board, spaceTypes, 'cache').map((found) => found.id)).toEqual(['b', 'a'])
  })

  test('the agent roster filters by the same rule', () => {
    const text = describeSpace(flow, spaceTypes, { query: 'server api' })
    expect(text).toContain('[api] note')
    expect(text).not.toContain('[web] note')
  })
})

describe('what an element is called', () => {
  test('its text on one line, or its type for an empty one', () => {
    const board = boardOf([
      { op: 'create', type: 'note', id: 'blank', x: 0, y: 0 },
      {
        op: 'create',
        type: 'note',
        id: 'long',
        x: 0,
        y: 300,
        text: `Many\n\nwords ${'x'.repeat(80)}`,
      },
    ])
    expect(elementName(board, spaceTypes, 'blank')).toBe('Sticky note')
    expect(elementName(board, spaceTypes, 'long', 12)).toBe('Many words …')
  })
})
