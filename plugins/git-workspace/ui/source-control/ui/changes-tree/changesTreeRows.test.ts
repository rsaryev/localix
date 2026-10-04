import { describe, expect, test } from 'bun:test'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'
import {
  buildChangesTree,
  changesTreeNavigation,
  createPrefixBuffer,
  flattenChangesTree,
  typeaheadMatch,
} from './changesTreeRows'

const change = (path: string): RepoFileChange => ({
  path,
  status: 'modified',
  staged: false,
  unstaged: true,
  insertions: 0,
  deletions: 0,
})

const rowsOf = (paths: string[], collapsed: string[] = []) =>
  flattenChangesTree(buildChangesTree(paths.map(change)), new Set(collapsed))

describe('flattenChangesTree', () => {
  test('folders first, children indented under an open folder, compacted chains', () => {
    const rows = rowsOf(['z.ts', 'src/app/a.ts', 'src/app/b.ts'])
    expect(rows.map((r) => `${r.depth}:${r.kind}:${r.name}`)).toEqual([
      '0:dir:src/app',
      '1:file:a.ts',
      '1:file:b.ts',
      '0:file:z.ts',
    ])
  })

  test('a collapsed folder hides its descendants but keeps its own row', () => {
    const rows = rowsOf(['src/a.ts', 'src/b.ts', 'z.ts'], ['src'])
    expect(rows.map((r) => r.path)).toEqual(['src', 'z.ts'])
  })

  test('a trailing-slash directory entry never becomes a nameless leaf', () => {
    expect(rowsOf(['docs/']).map((r) => r.name)).toEqual(['docs'])
    expect(rowsOf(['/'])).toEqual([])
  })
})

describe('changesTreeNavigation', () => {
  const rows = rowsOf(['src/a.ts', 'src/b.ts', 'z.ts'])

  test('Home/End reach rows that may not be mounted', () => {
    expect(changesTreeNavigation(rows, 1, 'End')).toEqual({ kind: 'focus', path: 'z.ts' })
    expect(changesTreeNavigation(rows, 3, 'Home')).toEqual({ kind: 'focus', path: 'src' })
  })

  test('Left from a file climbs to its folder; Left on an open folder closes it', () => {
    expect(changesTreeNavigation(rows, 2, 'ArrowLeft')).toEqual({ kind: 'focus', path: 'src' })
    expect(changesTreeNavigation(rows, 0, 'ArrowLeft')).toEqual({ kind: 'toggle', path: 'src' })
  })

  test('Right opens a closed folder, then steps into it', () => {
    const closed = rowsOf(['src/a.ts'], ['src'])
    expect(changesTreeNavigation(closed, 0, 'ArrowRight')).toEqual({ kind: 'toggle', path: 'src' })
    expect(changesTreeNavigation(rows, 0, 'ArrowRight')).toEqual({
      kind: 'focus',
      path: 'src/a.ts',
    })
  })
})

describe('typeahead', () => {
  const rows = rowsOf(['alpha.ts', 'beta.ts', 'bravo.ts'])

  test('a single character cycles its matches, wrapping', () => {
    expect(typeaheadMatch(rows, 0, 'b')).toBe('beta.ts')
    expect(typeaheadMatch(rows, 1, 'b')).toBe('bravo.ts')
    expect(typeaheadMatch(rows, 2, 'b')).toBe('beta.ts')
  })

  test('an extended prefix keeps a still-matching current row', () => {
    expect(typeaheadMatch(rows, 2, 'br')).toBe('bravo.ts')
  })

  test('the buffer accumulates within the timeout and collapses a repeated character', () => {
    let now = 0
    const feed = createPrefixBuffer(600, () => now)
    expect(feed('b')).toBe('b')
    now = 100
    expect(feed('r')).toBe('br')
    now = 2_000
    expect(feed('s')).toBe('s')
    now = 2_100
    expect(feed('s')).toBe('s')
  })
})
