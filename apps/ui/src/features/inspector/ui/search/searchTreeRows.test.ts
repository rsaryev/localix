import { describe, expect, test } from 'bun:test'
import type { FileContentMatch } from '@/shared/api/contracts'
import { buildSearchTree } from './searchTree'
import { estimateSearchRowSize, flattenSearchRows, type SearchRow } from './searchTreeRows'

const m = (path: string, line: number, context = 0): FileContentMatch => ({
  path,
  line,
  lineText: `line ${line}`,
  matchStart: 0,
  matchEnd: 4,
  ...(context
    ? {
        before: Array.from({ length: context }, (_, i) => `before ${i}`),
        after: Array.from({ length: context }, (_, i) => `after ${i}`),
      }
    : {}),
})

const shape = (rows: readonly SearchRow[]) =>
  rows.map((row) =>
    row.kind === 'match'
      ? `${'  '.repeat(row.depth)}match ${row.path}:${row.match.line}`
      : `${'  '.repeat(row.depth)}${row.kind} ${row.node.path}`,
  )

describe('flattenSearchRows', () => {
  test('projects the expanded tree into top-to-bottom rows', () => {
    const tree = buildSearchTree([
      m('apps/api/a.ts', 1),
      m('apps/api/a.ts', 2),
      m('apps/ui/c.ts', 5),
    ])

    expect(shape(flattenSearchRows(tree, new Set()))).toEqual([
      'dir apps',
      '  dir apps/api',
      '    file apps/api/a.ts',
      '      match apps/api/a.ts:1',
      '      match apps/api/a.ts:2',
      '  dir apps/ui',
      '    file apps/ui/c.ts',
      '      match apps/ui/c.ts:5',
    ])
  })

  test('a collapsed file keeps its own row and drops only its match rows', () => {
    const tree = buildSearchTree([
      m('apps/api/a.ts', 1),
      m('apps/api/a.ts', 2),
      m('apps/api/b.ts', 3),
    ])
    const rows = flattenSearchRows(tree, new Set(['apps/api/a.ts']))

    expect(shape(rows)).toEqual([
      'dir apps',
      '  dir apps/api',
      '    file apps/api/a.ts',
      '    file apps/api/b.ts',
      '      match apps/api/b.ts:3',
    ])
    const collapsedFile = rows.find((row) => row.kind === 'file' && row.node.path.endsWith('a.ts'))
    expect(collapsedFile?.kind === 'file' && collapsedFile.isOpen).toBe(false)
  })

  test('a collapsed directory drops its whole subtree', () => {
    const tree = buildSearchTree([m('apps/api/a.ts', 1), m('apps/ui/c.ts', 5)])
    expect(shape(flattenSearchRows(tree, new Set(['apps/api'])))).toEqual([
      'dir apps',
      '  dir apps/api',
      '  dir apps/ui',
      '    file apps/ui/c.ts',
      '      match apps/ui/c.ts:5',
    ])
  })

  test('row keys are unique even when two matches share a line and span', () => {
    const duplicate = m('a.ts', 7)
    const rows = flattenSearchRows(buildSearchTree([duplicate, { ...duplicate }]), new Set())
    const keys = rows.map((row) => row.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test('empty results flatten to no rows', () => {
    expect(flattenSearchRows(buildSearchTree([]), new Set())).toEqual([])
  })
})

describe('estimateSearchRowSize', () => {
  test('a match row with context lines estimates taller than one without', () => {
    const rows = flattenSearchRows(buildSearchTree([m('a.ts', 1), m('a.ts', 2, 2)]), new Set())
    const [, plain, withContext] = rows
    expect(plain?.kind).toBe('match')
    expect(withContext?.kind).toBe('match')
    // 2 before + 2 after → four extra rendered lines inside the same row.
    expect(estimateSearchRowSize(withContext)).toBeGreaterThan(estimateSearchRowSize(plain))
    expect(
      estimateSearchRowSize(withContext) - estimateSearchRowSize(plain),
    ).toBeGreaterThanOrEqual(4 * 16)
  })

  test('header rows and missing rows fall back to one header line box', () => {
    const [file] = flattenSearchRows(buildSearchTree([m('a.ts', 1)]), new Set())
    expect(estimateSearchRowSize(file)).toBe(estimateSearchRowSize(undefined))
    expect(estimateSearchRowSize(undefined)).toBeGreaterThan(0)
  })
})
