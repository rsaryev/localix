import { describe, expect, test } from 'bun:test'
import { buildPathTree, type PathTreeDir } from './path-tree'

describe('buildPathTree at scale', () => {
  test('a folder with thousands of subfolders builds in linear time', () => {
    // 40k sibling folders under one parent: the old `children.find` per segment scanned every
    // earlier sibling for every item — ~800M comparisons, measured ~1.8 s. Keyed by path it is
    // one lookup each (~25 ms), so the bound below separates the two by an order of magnitude.
    const items = Array.from({ length: 40_000 }, (_, i) => ({
      path: `pkg/mod-${i}/index.ts`,
      value: i,
    }))
    const started = performance.now()
    const [pkg] = buildPathTree(items)
    const elapsed = performance.now() - started
    expect((pkg as PathTreeDir<number>).children).toHaveLength(40_000)
    expect(elapsed).toBeLessThan(500)
  })

  test('repeated folders are shared, and a leaf never becomes a folder', () => {
    const tree = buildPathTree([
      { path: 'a/x', value: 1 },
      { path: 'a', value: 2 },
      { path: 'a/y', value: 3 },
    ])
    expect(tree.map((node) => `${node.type}:${node.name}`)).toEqual(['dir:a', 'leaf:a'])
    expect((tree[0] as PathTreeDir<number>).children.map((c) => c.name)).toEqual(['x', 'y'])
  })
})
