import { describe, expect, test } from 'bun:test'
import {
  type GridNode,
  makeLeaf,
  leafIds,
  firstLeaf,
  findLeaf,
  findLeafByRole,
  insertSplit,
  removeLeaf,
  resizeBranch,
  resizeAdjacentLeaves,
  normalize,
  renormalize,
} from './tree'

const leaf = (id: string, tabs: string[] = []) => makeLeaf(id, tabs)

/**
 * Narrow to a branch AND assert it. A bare `if (node.type === 'branch') expect(…)`
 * runs ZERO assertions when the operation under test returns a leaf — the exact
 * regression these tests exist to catch would pass green. Asserting inside the
 * narrowing makes the shape itself part of the guard.
 */
function asBranch(node: GridNode): Extract<GridNode, { type: 'branch' }> {
  expect(node.type).toBe('branch')
  if (node.type !== 'branch') throw new Error('expected a branch')
  return node
}
function asLeaf(node: GridNode): Extract<GridNode, { type: 'leaf' }> {
  expect(node.type).toBe('leaf')
  if (node.type !== 'leaf') throw new Error('expected a leaf')
  return node
}

describe('tree helpers', () => {
  test('makeLeaf defaults activeTab to the last tab', () => {
    expect(makeLeaf('g', ['a', 'b']).activeTab).toBe('b')
    expect(makeLeaf('g').activeTab).toBeNull()
  })

  test('leaves / leafIds walk left-to-right', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('a'), leaf('b'), leaf('c')],
      sizes: [0.3, 0.3, 0.4],
    }
    expect(leafIds(root)).toEqual(['a', 'b', 'c'])
    expect(firstLeaf(root).id).toBe('a')
  })

  test('findLeaf locates a leaf by id (null when absent)', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('a'), leaf('b')],
      sizes: [0.5, 0.5],
    }
    expect(findLeaf(root, 'a')?.id).toBe('a')
    expect(findLeaf(root, 'z')).toBeNull()
  })

  test('renormalize scales to 1; zero → even', () => {
    expect(renormalize([1, 1]).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(renormalize([0, 0])).toEqual([0.5, 0.5])
  })
})

describe('insertSplit', () => {
  test('splits a single leaf into a horizontal branch (right = after)', () => {
    const root = insertSplit(leaf('a', ['x']), 'a', 'right', leaf('b', ['y']))
    const b = asBranch(root)
    expect(b.orientation).toBe('h')
    expect(b.children.map((c) => c.id)).toEqual(['a', 'b'])
    expect(b.sizes).toEqual([0.5, 0.5])
  })

  test('left/up place the new leaf BEFORE the target', () => {
    const root = insertSplit(leaf('a'), 'a', 'left', leaf('b'))
    expect(asBranch(root).children.map((c) => c.id)).toEqual(['b', 'a'])
    const rootV = asBranch(insertSplit(leaf('a'), 'a', 'up', leaf('b')))
    expect(rootV.orientation).toBe('v')
    expect(rootV.children.map((c) => c.id)).toEqual(['b', 'a'])
  })

  test('nested split of same orientation flattens via normalize', () => {
    let root = insertSplit(leaf('a'), 'a', 'right', leaf('b')) // h[a,b]
    root = insertSplit(root, 'b', 'right', leaf('c')) // split b right → flattens to h[a,b,c]
    expect(leafIds(root)).toEqual(['a', 'b', 'c'])
    expect(asBranch(root).children.length).toBe(3)
  })
})

describe('removeLeaf', () => {
  test('removing one of two collapses the branch to the survivor', () => {
    const root = insertSplit(leaf('a'), 'a', 'right', leaf('b'))
    const { root: next, rehomeTo } = removeLeaf(root, 'b')
    expect(next.type).toBe('leaf')
    expect(next.id).toBe('a')
    expect(rehomeTo).toBe('a')
  })

  test('removing the LAST leaf keeps it but empties it', () => {
    const { root, rehomeTo } = removeLeaf(leaf('a', ['x', 'y']), 'a')
    expect(asLeaf(root).tabs).toEqual([])
    expect(rehomeTo).toBe('a')
  })

  test('re-homes focus to the previous sibling', () => {
    let root = insertSplit(leaf('a'), 'a', 'right', leaf('b'))
    root = insertSplit(root, 'b', 'right', leaf('c')) // h[a,b,c]
    const { rehomeTo } = removeLeaf(root, 'c')
    expect(rehomeTo).toBe('b')
  })
})

describe('resizeBranch', () => {
  test('updates a branch sizes (renormalized)', () => {
    const root = asBranch(insertSplit(leaf('a'), 'a', 'right', leaf('b')))
    expect(asBranch(resizeBranch(root, root.id, [3, 1])).sizes).toEqual([0.75, 0.25])
  })
})

describe('resizeAdjacentLeaves (leaf-anchored, robust to view≠raw)', () => {
  test('repartitions the pair the boundary lies between', () => {
    const root = insertSplit(leaf('a'), 'a', 'right', leaf('b')) // h[a,b]
    const next = asBranch(resizeAdjacentLeaves(root, 'a', 'b', 0.7))
    expect(next.sizes[0]).toBeCloseTo(0.7, 5)
    expect(next.sizes[1]).toBeCloseTo(0.3, 5)
  })

  test('touches ONLY the two adjacent children — a third sibling keeps its size', () => {
    let root = insertSplit(leaf('a'), 'a', 'right', leaf('b'))
    root = insertSplit(root, 'b', 'right', leaf('c')) // h[a,b,c]
    root = { ...asBranch(root), sizes: [0.2, 0.3, 0.5] }
    const next = asBranch(resizeAdjacentLeaves(root, 'a', 'b', 0.5)) // even a|b within their 0.5 pair
    expect(next.sizes[0]).toBeCloseTo(0.25, 5)
    expect(next.sizes[1]).toBeCloseTo(0.25, 5)
    expect(next.sizes[2]).toBeCloseTo(0.5, 5) // c untouched
  })

  test('finds the boundary even when the two leaves sit in nested branches', () => {
    // h[ a , V[b,c] ] — boundary between a and the (b,c) column, anchored on a & b.
    let root = insertSplit(leaf('a'), 'a', 'right', leaf('b'))
    root = insertSplit(root, 'b', 'down', leaf('c')) // a | [b/c]
    const next = asBranch(resizeAdjacentLeaves(root, 'a', 'b', 0.6))
    expect(next.sizes[0]).toBeCloseTo(0.6, 5) // a's column
    expect(next.sizes[1]).toBeCloseTo(0.4, 5) // the b/c column
  })

  test('no-op when a leaf is missing (returns the same root)', () => {
    const root = insertSplit(leaf('a'), 'a', 'right', leaf('b'))
    expect(resizeAdjacentLeaves(root, 'a', 'zzz', 0.7)).toBe(root)
  })
})

describe('findLeafByRole', () => {
  test('finds the first leaf carrying a role; survives a split', () => {
    const aux = makeLeaf('aux', ['c'], 'c', 'aux')
    const root = insertSplit(aux, 'aux', 'right', makeLeaf('ed', ['f'], 'f', 'editor'))
    expect(findLeafByRole(root, 'aux')?.id).toBe('aux')
    expect(findLeafByRole(root, 'editor')?.id).toBe('ed')
    expect(findLeafByRole(makeLeaf('solo'), 'editor')).toBeNull()
  })

  test('makeLeaf omits role when not given (plain user splits stay role-less)', () => {
    expect(makeLeaf('x').role).toBeUndefined()
  })
})

describe('normalize', () => {
  test('single-child branch collapses to the child', () => {
    const root: GridNode = {
      type: 'branch',
      id: 'b',
      orientation: 'h',
      children: [leaf('a')],
      sizes: [1],
    }
    expect(normalize(root)).toEqual(leaf('a'))
  })
})
