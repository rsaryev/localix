import { describe, expect, test } from 'bun:test'
import {
  buildSearchTree,
  collectNodePaths,
  type SearchDirNode,
  type SearchFileNode,
} from './searchTree'
import type { FileContentMatch } from '@/shared/api/contracts'

const m = (path: string, line: number): FileContentMatch => ({
  path,
  line,
  lineText: `line ${line}`,
  matchStart: 0,
  matchEnd: 4,
})

describe('buildSearchTree', () => {
  test('nests matches into a folder/file tree with recursive counts', () => {
    const tree = buildSearchTree([
      m('apps/api/a.ts', 1),
      m('apps/api/a.ts', 2),
      m('apps/api/b.ts', 1),
      m('apps/ui/c.ts', 1),
    ])
    expect(tree).toHaveLength(1)
    const apps = tree[0] as SearchDirNode
    expect(apps.type).toBe('dir')
    expect(apps.name).toBe('apps')
    expect(apps.count).toBe(4) // 2 + 1 + 1
    const [api, ui] = apps.children as SearchDirNode[]
    expect(api.name).toBe('api')
    expect(api.count).toBe(3)
    expect(ui.count).toBe(1)
    const aFile = api.children[0] as SearchFileNode
    expect(aFile.type).toBe('file')
    expect(aFile.path).toBe('apps/api/a.ts')
    expect(aFile.matches).toHaveLength(2)
  })

  test('keeps a loose top-level file as a file node', () => {
    const tree = buildSearchTree([m('README.md', 3)])
    expect(tree).toHaveLength(1)
    const f = tree[0] as SearchFileNode
    expect(f.type).toBe('file')
    expect(f.name).toBe('README.md')
  })

  test('empty input → empty tree', () => {
    expect(buildSearchTree([])).toEqual([])
  })

  test('collectNodePaths returns every dir + file path (for collapse-all)', () => {
    const tree = buildSearchTree([m('apps/api/a.ts', 1), m('apps/ui/c.ts', 1)])
    expect(new Set(collectNodePaths(tree))).toEqual(
      new Set(['apps', 'apps/api', 'apps/api/a.ts', 'apps/ui', 'apps/ui/c.ts']),
    )
  })
})
