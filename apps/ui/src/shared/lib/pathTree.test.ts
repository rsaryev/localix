import { describe, expect, test } from 'bun:test'
import { buildPathTree, folderPaths, type PathTreeNode } from '@localixai/plugin-sdk/ui/path-tree'

const items = (...paths: string[]) => paths.map((path) => ({ path, value: path }))

/** `a/b` → `dir a > dir b`, leaves as `name`. Compact enough to read a whole tree in one line. */
function sketch(nodes: ReadonlyArray<PathTreeNode<string>>): string {
  return nodes
    .map((n) => (n.type === 'dir' ? `[${n.name}: ${sketch(n.children)}]` : n.name))
    .join(' ')
}

describe('the shape a person expects', () => {
  test('folders come before leaves, each sorted by name', () => {
    expect(sketch(buildPathTree(items('zeta', 'alpha/one', 'beta')))).toBe('[alpha: one] beta zeta')
  })

  test('a leaf keeps its full path as identity, and its last segment as label', () => {
    const [dir] = buildPathTree(items('users/admin/list'))
    expect(dir!.type).toBe('dir')
    const leaf = (dir as { children: PathTreeNode<string>[] }).children[0]!
    expect(leaf).toMatchObject({ type: 'leaf', name: 'list', path: 'users/admin/list' })
  })

  test('siblings share their folder rather than each minting one', () => {
    expect(sketch(buildPathTree(items('users/one', 'users/two')))).toBe('[users: one two]')
  })

  test('explicit empty folders remain visible beside request-derived folders', () => {
    expect(sketch(buildPathTree(items('users/list'), ['drafts', 'users/admin']))).toBe(
      '[drafts: ] [users: [admin: ] list]',
    )
  })
})

describe('single-child chains compact', () => {
  test('a folder holding only one folder becomes one row', () => {
    // Three rows to reach one file is three rows of nothing.
    expect(sketch(buildPathTree(items('a/b/c/leaf')))).toBe('[a/b/c: leaf]')
  })

  test('the compacted row keeps the DEEPEST path, so expanding it addresses the real folder', () => {
    const [dir] = buildPathTree(items('a/b/leaf'))
    expect(dir).toMatchObject({ type: 'dir', name: 'a/b', path: 'a/b' })
  })

  test('a chain stops compacting where it branches', () => {
    expect(sketch(buildPathTree(items('a/b/one', 'a/b/two')))).toBe('[a/b: one two]')
    expect(sketch(buildPathTree(items('a/b/one', 'a/other')))).toBe('[a: [b: one] other]')
  })

  test('a folder holding a leaf AND a folder does not compact', () => {
    expect(sketch(buildPathTree(items('a/leaf', 'a/b/deep')))).toBe('[a: [b: deep] leaf]')
  })
})

describe('degenerate input never renders a blank row', () => {
  test.each(['/leading', 'trailing/', 'double//slash', '/'])('%p', (path) => {
    const tree = buildPathTree(items(path))
    const names: string[] = []
    const walk = (nodes: ReadonlyArray<PathTreeNode<string>>) => {
      for (const n of nodes) {
        names.push(n.name)
        if (n.type === 'dir') walk(n.children)
      }
    }
    walk(tree)
    expect(names.every((n) => n.length > 0)).toBe(true)
  })

  test('an empty list is an empty tree, not a nameless root', () => {
    expect(buildPathTree([])).toEqual([])
  })
})

describe('folderPaths', () => {
  test('names every folder, including nested ones', () => {
    expect(folderPaths(buildPathTree(items('a/x', 'a/b/y', 'c/z')))).toEqual(['a', 'a/b', 'c'])
  })

  test('a compacted chain reports the ONE row that exists, not each segment', () => {
    // Otherwise "expand all" would try to expand rows the tree never rendered.
    expect(folderPaths(buildPathTree(items('a/b/c/leaf')))).toEqual(['a/b/c'])
  })
})
