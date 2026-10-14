import { expect, test } from 'bun:test'
import { sessionSubtreeForDeletion } from './session-subtree'

test('enumerates arbitrarily nested descendants before their parents', async () => {
  const tree: Record<string, string[]> = {
    root: ['a', 'b'],
    a: ['grandchild'],
    grandchild: ['leaf'],
  }
  const ordered = await sessionSubtreeForDeletion('root', async (id) => tree[id] ?? [])
  expect(new Set(ordered)).toEqual(new Set(['root', 'a', 'b', 'grandchild', 'leaf']))
  for (const [parent, children] of Object.entries(tree))
    for (const child of children)
      expect(ordered.indexOf(child)).toBeLessThan(ordered.indexOf(parent))
})

test('rejects cyclic topology before returning a deletion set', async () => {
  await expect(sessionSubtreeForDeletion('root', async () => ['root'])).rejects.toThrow(
    'repeated identity',
  )
})

test('propagates an unreadable descendant instead of returning a partial tree', async () => {
  await expect(
    sessionSubtreeForDeletion('root', async (id) => {
      if (id === 'root') return ['child']
      throw new Error('read failed')
    }),
  ).rejects.toThrow('read failed')
})
