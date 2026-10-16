import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { DirEntry } from '@/shared/api/contracts'

import { filterFileTree } from './fileTreeFilter'
import {
  fileTreeEntryRows,
  fileTreeNavigation,
  flattenFileTreeRows,
  type FlattenFileTreeRowsInput,
} from './fileTreeRows'

const dir = (name: string): DirEntry => ({ name, type: 'dir' }) as DirEntry
const file = (name: string): DirEntry => ({ name, type: 'file' }) as DirEntry

const input = (
  childrenByPath: Record<string, DirEntry[]>,
  overrides: Partial<FlattenFileTreeRowsInput> = {},
): FlattenFileTreeRowsInput => ({
  root: '/p',
  childrenByPath,
  truncatedByPath: {},
  expanded: new Set(),
  loading: new Set(),
  edit: null,
  filter: null,
  compactEnabled: false,
  ...overrides,
})

describe('flattenFileTreeRows', () => {
  test('projects entry and status rows in exact visible order', () => {
    const children = {
      '/p': [dir('src'), file('readme.md')],
      '/p/src': [file('a.ts'), dir('empty')],
      '/p/src/empty': [],
    }
    const rows = flattenFileTreeRows(
      input(children, {
        expanded: new Set(['/p/src', '/p/src/empty']),
        truncatedByPath: { '/p/src': 7 },
      }),
    )

    expect(
      rows.map((row) =>
        row.kind === 'entry'
          ? row.path
          : row.kind === 'status'
            ? `${row.status}:${row.parentPath}`
            : row.key,
      ),
    ).toEqual([
      '/p/src',
      '/p/src/a.ts',
      '/p/src/empty',
      'empty:/p/src/empty',
      'truncated:/p/src',
      '/p/readme.md',
    ])
    expect(fileTreeEntryRows(rows).map((row) => row.depth)).toEqual([0, 1, 1, 0])
    expect(
      fileTreeEntryRows(rows).map((row) => [row.path, row.ariaPosInSet, row.ariaSetSize]),
    ).toEqual([
      ['/p/src', 1, 2],
      ['/p/src/a.ts', 1, 2],
      ['/p/src/empty', 2, 2],
      ['/p/readme.md', 2, 2],
    ])
  })

  test('represents loading and inline edits without inventing navigable rows', () => {
    const children = { '/p': [dir('src'), file('old.ts')] }
    const rows = flattenFileTreeRows(
      input(children, {
        expanded: new Set(['/p/src']),
        loading: new Set(['/p/src']),
        edit: {
          mode: 'rename',
          path: '/p/old.ts',
          parentPath: '/p',
          name: 'old.ts',
          kind: 'file',
        },
      }),
    )

    expect(rows.map((row) => row.kind)).toEqual(['entry', 'status', 'edit'])
    expect(fileTreeEntryRows(rows).map((row) => row.path)).toEqual(['/p/src'])
  })

  test('a create row precedes its siblings and remains when the folder is empty', () => {
    const rows = flattenFileTreeRows(
      input({ '/p': [] }, { edit: { mode: 'create', parentPath: '/p', kind: 'file' } }),
    )
    expect(rows.map((row) => row.key)).toEqual(['edit:create:/p'])
  })

  test('uses the filter model for visibility, forced expansion, and show-all subtrees', () => {
    const children = {
      '/p': [dir('src'), file('readme.md')],
      '/p/src': [dir('util'), file('index.ts')],
      '/p/src/util': [file('helper.ts'), file('other.ts')],
    }
    const filter = filterFileTree('/p', children, 'helper')!
    const rows = flattenFileTreeRows(input(children, { filter }))

    expect(fileTreeEntryRows(rows).map((row) => row.path)).toEqual([
      '/p/src',
      '/p/src/util',
      '/p/src/util/helper.ts',
    ])
    expect(fileTreeEntryRows(rows).map((row) => row.isOpen)).toEqual([true, true, false])
  })

  test('folds a compact directory chain into one row keyed by its endpoint', () => {
    const children = {
      '/p': [dir('src'), file('readme.md')],
      '/p/src': [dir('main')],
      '/p/src/main': [file('a.ts'), file('b.ts')],
    }
    const rows = fileTreeEntryRows(
      flattenFileTreeRows(
        input(children, {
          compactEnabled: true,
          expanded: new Set(['/p/src/main']),
        }),
      ),
    )

    expect(rows.map((row) => row.path)).toEqual([
      '/p/src/main',
      '/p/src/main/a.ts',
      '/p/src/main/b.ts',
      '/p/readme.md',
    ])
    expect(rows[0]?.compactChain).toEqual(['/p/src', '/p/src/main'])
  })

  test('flattens a 5,000-row directory without recursive React construction', () => {
    const children = {
      '/p': Array.from({ length: 5_000 }, (_, index) => file(`file-${index}.ts`)),
    }
    const rows = flattenFileTreeRows(input(children))
    expect(rows).toHaveLength(5_000)
    expect(rows[4_999]?.key).toBe('entry:/p/file-4999.ts')
  })
})

describe('fileTreeNavigation', () => {
  const children = {
    '/p': [dir('src'), file('readme.md')],
    '/p/src': [file('a.ts'), dir('empty')],
    '/p/src/empty': [],
  }
  const rows = fileTreeEntryRows(
    flattenFileTreeRows(input(children, { expanded: new Set(['/p/src', '/p/src/empty']) })),
  )

  test('moves over semantic entry rows while skipping empty/loading status rows', () => {
    expect(fileTreeNavigation(rows, '/p/src/a.ts', 'ArrowDown')).toEqual({
      kind: 'focus',
      path: '/p/src/empty',
    })
    expect(fileTreeNavigation(rows, '/p/src/empty', 'ArrowDown')).toEqual({
      kind: 'focus',
      path: '/p/readme.md',
    })
  })

  test('right enters only a real child and left finds the nearest shallower parent', () => {
    expect(fileTreeNavigation(rows, '/p/src', 'ArrowRight')).toEqual({
      kind: 'focus',
      path: '/p/src/a.ts',
    })
    expect(fileTreeNavigation(rows, '/p/src/a.ts', 'ArrowLeft')).toEqual({
      kind: 'focus',
      path: '/p/src',
    })
    // An expanded but empty directory has no child entry; the next sibling is
    // not accidentally treated as one.
    expect(fileTreeNavigation(rows, '/p/src/empty', 'ArrowRight')).toBeNull()
  })

  test('collapses open directories and expands closed ones', () => {
    expect(fileTreeNavigation(rows, '/p/src', 'ArrowLeft')).toEqual({
      kind: 'toggle',
      path: '/p/src',
    })
    const closedRows = rows.map((row) => (row.path === '/p/src' ? { ...row, isOpen: false } : row))
    expect(fileTreeNavigation(closedRows, '/p/src', 'ArrowRight')).toEqual({
      kind: 'toggle',
      path: '/p/src',
    })
  })
})

describe('virtualized Explorer contract', () => {
  test('renders the flat model through TanStack Virtual without recursive tree JSX', () => {
    const sidebar = readFileSync(new URL('./FileTreeSidebar.tsx', import.meta.url), 'utf8')
    const entries = readFileSync(new URL('./FileTreeEntries.tsx', import.meta.url), 'utf8')

    expect(sidebar).toContain('useVirtualizer<HTMLDivElement, HTMLDivElement>')
    expect(sidebar).toContain('rangeExtractor')
    expect(sidebar).not.toContain('querySelectorAll')
    expect(entries).not.toMatch(/<FileTreeEntries\b/)
    expect(entries).toContain('getVirtualItems()')
  })
})
