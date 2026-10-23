import { expect, test } from 'bun:test'
import { editTableColumn } from './table-ops'
import { addMindNode, mindBranch, moveMindBranch, removeMindBranch } from './mindmap-ops'
import { emptySpace } from '../format/document'
import { applyOps } from '../ops/apply'
import { applyPatch } from '../ops/draft'
import { spaceTypes } from './index'

test('column edits move their cells atomically and reject invalid or destructive empty structures', () => {
  const value = {
    title: 'Table',
    columns: ['A', 'B'],
    rows: [
      ['a1', 'b1'],
      ['a2', 'b2'],
    ],
  }
  expect(editTableColumn(value, { kind: 'move', index: 0, direction: 1 })).toEqual({
    columns: ['B', 'A'],
    rows: [
      ['b1', 'a1'],
      ['b2', 'a2'],
    ],
  })
  expect(editTableColumn(value, { kind: 'insert', index: 1 })).toEqual({
    columns: ['A', 'Column 3', 'B'],
    rows: [
      ['a1', '', 'b1'],
      ['a2', '', 'b2'],
    ],
  })
  expect(editTableColumn(value, { kind: 'rename', index: 0, title: ' Task ' })?.columns).toEqual([
    'Task',
    'B',
  ])
  expect(editTableColumn(value, { kind: 'remove', index: 0 })).toEqual({
    columns: ['B'],
    rows: [['b1'], ['b2']],
  })
  expect(
    editTableColumn({ ...value, columns: ['A'], rows: [['a']] }, { kind: 'remove', index: 0 }),
  ).toBeNull()
  expect(editTableColumn(value, { kind: 'move', index: 0, direction: -1 })).toBeNull()
  expect(editTableColumn(value, { kind: 'rename', index: 0, title: ' ' })).toBeNull()
  const created = applyOps(
    emptySpace(),
    [{ op: 'create', type: 'table', id: 'table', props: value }],
    { registry: spaceTypes },
  ).space
  const edited = applyOps(
    created,
    [{ op: 'update', id: 'table', props: editTableColumn(value, { kind: 'remove', index: 0 })! }],
    { registry: spaceTypes },
  )
  expect(edited.results[0]!.ok).toBe(true)
  expect(applyPatch(edited.space, edited.patch, 0).space.elements.table).toEqual(
    created.elements.table,
  )
})

test('visual mindmap edits keep one root, move subtrees and never introduce cycles', () => {
  const nodes = [
    { id: 'root', text: 'Root' },
    { id: 'a', text: 'A', parent: 'root' },
    { id: 'aa', text: 'AA', parent: 'a' },
    { id: 'b', text: 'B', parent: 'root' },
  ]
  expect(mindBranch(nodes, 'a')).toEqual(new Set(['a', 'aa']))
  const added = addMindNode(nodes, 'a')!
  expect(added.at(-1)).toMatchObject({ text: 'New idea', parent: 'a' })
  expect(addMindNode(nodes, 'missing')).toBeNull()
  expect(removeMindBranch(nodes, 'a')!.map((node) => node.id)).toEqual(['root', 'b'])
  expect(removeMindBranch(nodes, 'root')).toBeNull()
  expect(moveMindBranch(nodes, 'a', 'aa')).toBeNull()
  expect(moveMindBranch(nodes, 'root', 'b')).toBeNull()
  const moved = moveMindBranch(nodes, 'a', 'b')!
  expect(moved.find((node) => node.id === 'aa')?.parent).toBe('a')
  expect(spaceTypes.get('mindmap')!.props.safeParse({ nodes: moved }).success).toBe(true)
  const created = applyOps(
    emptySpace(),
    [{ op: 'create', type: 'mindmap', id: 'map', props: { nodes } }],
    { registry: spaceTypes },
  ).space
  const edited = applyOps(created, [{ op: 'update', id: 'map', props: { nodes: moved } }], {
    registry: spaceTypes,
  })
  expect(applyPatch(edited.space, edited.patch, 0).space.elements.map).toEqual(created.elements.map)
})
