import { expect, test } from 'bun:test'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { insertOnEdgeOps } from './commands'

test('a shape inserted into a connector splits it into two that keep its look', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'a',
        type: 'shape',
        x: 0,
        y: 0,
        w: 160,
        h: 96,
        props: { color: 'green' },
      },
      { op: 'create', id: 'b', type: 'shape', x: 600, y: 0, w: 160, h: 96 },
      {
        op: 'connect',
        id: 'ab',
        from: 'a',
        to: 'b',
        label: 'build',
        route: 'elbow',
        stroke: 'dashed',
        weight: 'bold',
        labelAt: 0.3,
      },
    ],
    { registry: spaceTypes },
  )
  let seed = 0
  const insert = insertOnEdgeOps(space, 'ab', () => (seed = (seed + 0.37) % 1))!
  const after = applyOps(space, insert.ops, { registry: spaceTypes })
  expect(after.results.every((result) => result.ok)).toBe(true)

  const step = after.space.elements[insert.created]!
  expect(step).toMatchObject({ type: 'shape', x: 300, y: 0 })
  expect(step.props.color).toBe('green')
  const edges = Object.values(after.space.edges)
  expect(edges).toHaveLength(2)
  expect(edges.map((edge) => [edge.from, edge.to])).toEqual([
    ['a', insert.created],
    [insert.created, 'b'],
  ])
  for (const edge of edges)
    expect(edge).toMatchObject({ route: 'elbow', stroke: 'dashed', weight: 'bold' })
  // The label stays with the first half, back at its middle.
  expect(edges[0]).toMatchObject({ label: 'build' })
  expect(edges[0]?.labelAt).toBeUndefined()
  expect(edges[1]?.label).toBeUndefined()
})
