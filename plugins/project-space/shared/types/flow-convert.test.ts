import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import { flowToShapesOps } from './flow-convert'
import type { FlowProps } from './flow'
import { spaceTypes } from './index'

const CHART = `flowchart LR
  subgraph ship [Release]
    tag[Tag<br/>git tag]:::focal ==> reg[(Registry)]:::store
  end
  pr([PR]) -->|opens| ci{CI?}
  ci -.->|no| pr
  ci --> tag`

test('a flowchart taken apart keeps its steps, lines and subgraphs as board pieces', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'chart',
        type: 'flow',
        x: 100,
        y: 50,
        text: CHART,
        props: { color: 'green' },
      },
    ],
    { registry: spaceTypes },
  )
  const element = space.elements.chart!
  const read = spaceTypes.read('flow', element.props, 1)
  if (read.status !== 'ok') throw new Error('flow rejected')
  let seed = 0
  const ops = flowToShapesOps(space, 'chart', element, read.props as FlowProps, () => {
    seed = (seed + 0.618) % 1
    return seed
  })
  const after = applyOps(space, ops, { registry: spaceTypes })
  expect(after.results.every((result) => result.ok)).toBe(true)
  expect(after.space.elements.chart).toBeUndefined()

  const all = Object.values(after.space.elements)
  const frames = all.filter((item) => item.type === 'frame')
  const shapes = all.filter((item) => item.type === 'shape')
  expect(frames.map((frame) => frame.props.title)).toEqual(['Release'])
  expect(shapes).toHaveLength(4)

  const byName = (name: string) => shapes.find((shape) => String(shape.props.text).includes(name))!
  expect(byName('Tag').props).toMatchObject({ text: '**Tag**\n`git tag`', color: 'green' })
  expect(byName('Registry').props).toMatchObject({ kind: 'cylinder', fill: 'solid', color: 'gray' })
  expect(byName('CI?').props.kind).toBe('diamond')
  // The steps of the subgraph lie inside its frame, so the frame holds them.
  const frame = frames[0]!
  for (const name of ['Tag', 'Registry']) {
    const shape = byName(name)
    expect(shape.x).toBeGreaterThanOrEqual(frame.x)
    expect(shape.x + shape.w).toBeLessThanOrEqual(frame.x + frame.w)
  }

  const edges = Object.values(after.space.edges)
  expect(edges).toHaveLength(4)
  expect(edges.every((edge) => edge.route === 'elbow')).toBe(true)
  // A loop keeps running around the outside: both its ends on the outer side, as in the chart.
  expect(edges.find((edge) => edge.label === 'no')).toMatchObject({
    stroke: 'dashed',
    fromSide: 'bottom',
    toSide: 'bottom',
  })
  expect(edges.find((edge) => edge.weight === 'bold')).toMatchObject({ color: 'green' })
  // The pieces move as one until the person takes the group apart.
  const groups = new Set(shapes.map((shape) => shape.groups?.[0]))
  expect(groups.size).toBe(1)
  expect([...groups][0]).toBeDefined()
})

test('two lines between the same steps become one connector with both labels', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'c',
        type: 'flow',
        x: 0,
        y: 0,
        text: 'flowchart LR\n  a -->|yes| b\n  a -->|no| b',
      },
    ],
    { registry: spaceTypes },
  )
  const read = spaceTypes.read('flow', space.elements.c!.props, 1)
  if (read.status !== 'ok') throw new Error('flow rejected')
  const ops = flowToShapesOps(space, 'c', space.elements.c!, read.props as FlowProps)
  const after = applyOps(space, ops, { registry: spaceTypes })
  expect(after.results.every((result) => result.ok)).toBe(true)
  expect(Object.values(after.space.edges).map((edge) => edge.label)).toEqual(['yes / no'])
})
