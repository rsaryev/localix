import { expect, test } from 'bun:test'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { membersOf } from '../../shared/ops/geometry'
import { spaceTypes } from '../../shared/types'
import { frameAroundOps, pasteStyleOps, styleOf } from './commands'

const board = () =>
  applyOps(
    emptySpace(),
    [
      {
        op: 'create',
        id: 'note',
        type: 'note',
        x: 0,
        y: 0,
        props: { color: 'green', font: 'hand', align: 'center', size: 'auto' },
      },
      { op: 'create', id: 'shape', type: 'shape', x: 300, y: 40, props: { color: 'blue' } },
      { op: 'create', id: 'frame', type: 'frame', x: 0, y: 400, w: 400, h: 200 },
    ],
    { registry: spaceTypes },
  ).space

test('a pasted style reaches each element only where its type takes the value', () => {
  const space = board()
  const style = styleOf(space, 'note')!
  expect(style).toMatchObject({ color: 'green', font: 'hand', align: 'center', size: 'auto' })
  const ops = pasteStyleOps({ space, ids: ['shape', 'frame'], entered: null }, style)!
  const after = applyOps(space, ops, { registry: spaceTypes }).space
  // A shape takes the colour, face and alignment, not the note's `auto` size it has no use for.
  expect(after.elements.shape?.props).toMatchObject({
    color: 'green',
    font: 'hand',
    align: 'center',
    size: 'm',
  })
  // A frame has only a colour.
  expect(after.elements.frame?.props).toEqual({ title: 'Frame', color: 'green' })
})

test('a frame made around the selection holds it, and its id comes back to name it', () => {
  const space = board()
  const framed = frameAroundOps({ space, ids: ['note', 'shape'], entered: null }, () => 0.42)!
  const after = applyOps(space, framed.ops, { registry: spaceTypes }).space
  expect(after.elements[framed.id]?.type).toBe('frame')
  expect(membersOf(after, framed.id, spaceTypes).sort()).toEqual(['note', 'shape'])
})

test('the selection filter counts each kind it can narrow to', async () => {
  const { selectionKinds } = await import('./FilterMenu')
  const kinds = selectionKinds(board(), ['note', 'shape', 'frame', 'gone'])
  expect([...kinds].map(([type, ids]) => [type, ids])).toEqual([
    ['note', ['note']],
    ['shape', ['shape']],
    ['frame', ['frame']],
  ])
})
