import { describe, expect, test } from 'bun:test'
import type { SpaceView } from '../../shared/api'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { dragOps } from './moves'
import { toFlow } from './toFlow'

const space = applyOps(
  emptySpace(),
  [
    { op: 'create', type: 'note', id: 'late', x: 50, y: 50 },
    { op: 'create', type: 'frame', id: 'f', x: 0, y: 0, w: 600, h: 400 },
    { op: 'create', type: 'note', id: 'out', x: 900, y: 0 },
    {
      op: 'connect',
      id: 'e',
      from: 'late',
      to: 'out',
      start: 'circle',
      route: 'elbow',
      stroke: 'dashed',
      color: 'red',
    },
  ],
  { registry: spaceTypes },
).space
const view: SpaceView = {
  space,
  issues: [],
  writable: true,
  revision: 'r',
  canUndo: false,
  canRedo: false,
  missing: [],
  stamps: {},
}

describe('the board as the flow library draws it', () => {
  test('a frame is a layer below the rest, even when it was stacked above them', () => {
    const { nodes } = toFlow(view, spaceTypes)
    expect(nodes.map((node) => node.id)).toEqual(['f', 'late', 'out'])
    expect(nodes[0]!.zIndex).toBeLessThan(nodes[1]!.zIndex!)
  })

  test('a connector floats and carries its caps, route, stroke and colour', () => {
    const [edge] = toFlow(view, spaceTypes).edges
    expect(edge?.data).toMatchObject({
      float: true,
      startCap: 'circle',
      endCap: 'triangle',
      route: 'step',
      stroke: 'dashed',
    })
    expect(edge?.data?.toneClass).toContain('space-tone-red')
  })
})

describe('a finished drag', () => {
  test('a dragged frame is one move; what it holds is carried, not moved twice', () => {
    const ops = dragOps(
      space,
      [
        { id: 'late', x: 150, y: 150 },
        { id: 'f', x: 100, y: 100 },
        { id: 'out', x: 950, y: 0 },
      ],
      spaceTypes,
    )
    expect(ops).toEqual([
      { op: 'update', id: 'f', x: 100, y: 100 },
      { op: 'update', id: 'out', x: 950, y: 0 },
    ])
  })

  test('an element released where it started writes nothing', () => {
    expect(dragOps(space, [{ id: 'out', x: 900.3, y: 0 }], spaceTypes)).toEqual([])
  })
})
