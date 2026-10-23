import { expect, test } from 'bun:test'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { switchTypeOps } from './switchType'

test('a note turned into a shape keeps its id, text, look, place and connectors', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'idea',
        type: 'note',
        x: 10,
        y: 20,
        w: 220,
        h: 180,
        text: '**Ship** it',
        props: { color: 'green', font: 'hand', size: 'lg' },
      },
      { op: 'create', id: 'next', type: 'shape', x: 400, y: 20 },
      { op: 'connect', id: 'link', from: 'idea', to: 'next', label: 'then', route: 'elbow' },
      { op: 'create', id: 'top', type: 'note', x: 0, y: 400 },
      { op: 'group', ids: ['idea', 'next'], id: 'pair' },
    ],
    { registry: spaceTypes },
  )
  const ops = switchTypeOps(space, 'idea', 'shape')!
  const after = applyOps(space, ops, { registry: spaceTypes })
  expect(after.results.every((result) => result.ok)).toBe(true)
  // The same record: still in its group, still where it stacked, under the note made after it.
  expect(after.space.elements.idea?.groups).toEqual(['pair'])
  expect(after.space.elements.idea?.z).toBe(space.elements.idea?.z)
  const shape = after.space.elements.idea!
  expect(shape).toMatchObject({ type: 'shape', x: 10, y: 20, w: 220, h: 180 })
  // Colour and face carry over; a note's `lg` is no shape size, so the shape keeps its own.
  expect(shape.props).toMatchObject({
    text: '**Ship** it',
    color: 'green',
    font: 'hand',
    size: 'm',
  })
  expect(after.space.edges.link).toMatchObject({
    from: 'idea',
    to: 'next',
    label: 'then',
    route: 'elbow',
  })

  expect(switchTypeOps(after.space, 'idea', 'shape')).toBeNull()
  const text = applyOps(after.space, switchTypeOps(after.space, 'idea', 'text')!, {
    registry: spaceTypes,
  }).space.elements.idea!
  expect(text.props).toMatchObject({ text: '**Ship** it', font: 'hand' })
})

test('a Mermaid flowchart drawn natively keeps its connectors, and a kind that does not exist is refused', async () => {
  const { mermaidViews } = await import('../elements/mermaid')
  const { space } = applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'chart',
        type: 'mermaid',
        x: 0,
        y: 0,
        props: { source: 'flowchart LR\n  a --> b', title: 'Flow' },
      },
      { op: 'create', id: 'note', type: 'note', x: 900, y: 0 },
      { op: 'connect', id: 'see', from: 'note', to: 'chart' },
    ],
    { registry: spaceTypes },
  )
  const read = spaceTypes.read('mermaid', space.elements.chart!.props)
  if (read.status !== 'ok') throw new Error('mermaid rejected')
  const ops = mermaidViews[0]!.actions![0]!.ops({
    id: 'chart',
    element: space.elements.chart!,
    props: read.props,
    space,
  })!
  const after = applyOps(space, ops, { registry: spaceTypes }).space
  expect(after.elements.chart).toMatchObject({ type: 'flow', props: { title: 'Flow' } })
  expect(after.edges.see).toMatchObject({ from: 'note', to: 'chart' })

  const refused = applyOps(space, [{ op: 'update', id: 'note', type: 'nothing' }], {
    registry: spaceTypes,
  })
  expect(refused.results[0]).toMatchObject({ ok: false })
  expect(refused.space.elements.note?.type).toBe('note')
})
