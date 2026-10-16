import { expect, test } from 'bun:test'

import { makeLeaf, resizeAdjacentLeaves, type BranchNode } from './tree'

test('a reversed resize boundary assigns the requested share to the named leaf and retains sibling identity', () => {
  const inner: BranchNode = {
    type: 'branch',
    id: 'inner',
    orientation: 'h',
    children: [makeLeaf('a'), makeLeaf('b')],
    sizes: [0.5, 0.5],
  }
  const untouched = makeLeaf('c')
  const root: BranchNode = {
    type: 'branch',
    id: 'root',
    orientation: 'v',
    children: [inner, untouched],
    sizes: [0.6, 0.4],
  }
  Object.freeze(inner.sizes)
  Object.freeze(inner.children)
  Object.freeze(inner)
  Object.freeze(root.children)
  Object.freeze(root)
  const resized = resizeAdjacentLeaves(root, 'b', 'a', 0.7) as BranchNode
  const changed = resized.children[0] as BranchNode
  expect(changed.sizes[0]).toBeCloseTo(0.3)
  expect(changed.sizes[1]).toBeCloseTo(0.7)
  expect(changed.children).toBe(inner.children)
  expect(resized.children[1]).toBe(untouched)
  expect(resized.sizes).toBe(root.sizes)
  expect(inner.sizes).toEqual([0.5, 0.5])
  expect(root.children[0]).toBe(inner)
})
