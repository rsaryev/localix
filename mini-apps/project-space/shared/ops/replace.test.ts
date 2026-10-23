import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { spaceTypes } from '../types'
import { applyOps } from './apply'
import { replaceOps } from './replace'

test('find and replace changes the board’s words, never a diagram or a path', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      { op: 'create', id: 'note', type: 'note', x: 0, y: 0, text: 'Ship v1 today. v1 is ready' },
      { op: 'create', id: 'frame', type: 'frame', x: 0, y: 300, text: 'Release V1' },
      { op: 'create', id: 'file', type: 'file', x: 400, y: 0, props: { path: 'src/v1.ts' } },
      {
        op: 'create',
        id: 'chart',
        type: 'flow',
        x: 0,
        y: 600,
        text: 'flowchart LR\n  v1[v1] --> v2',
      },
      { op: 'create', id: 'locked', type: 'note', x: 300, y: 0, text: 'v1', locked: true },
      { op: 'connect', id: 'e', from: 'note', to: 'frame', label: 'after v1' },
    ],
    { registry: spaceTypes },
  )
  const { ops, count } = replaceOps(space, spaceTypes, 'V1', 'v2')
  expect(count).toBe(4)
  const after = applyOps(space, ops, { registry: spaceTypes }).space
  expect(after.elements.note?.props.text).toBe('Ship v2 today. v2 is ready')
  expect(after.elements.frame?.props.title).toBe('Release v2')
  expect(after.edges.e?.label).toBe('after v2')
  expect(after.elements.file?.props.path).toBe('src/v1.ts')
  expect(after.elements.locked?.props.text).toBe('v1')
  expect(JSON.stringify(after.elements.chart?.props)).toContain('"v1"')
  // A replacement with `$&` in it is written as typed, not read as a pattern.
  expect(replaceOps(space, spaceTypes, 'today', '$& $1').ops[0]).toMatchObject({
    props: { text: 'Ship v1 $& $1. v1 is ready' },
  })
})
