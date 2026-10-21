import { describe, expect, test } from 'bun:test'
import {
  normalizeTabPath,
  resolveTabIdentity,
  tabIdentityOf,
  TAB_IDENTITY_CONTENT_CAP,
  type TabIdentity,
  type WorkItem,
} from '@/shared/lib/workItem'

const file = (path?: string, title = 'x', content?: string): TabIdentity => ({
  kind: 'file',
  id: `id:${path ?? title}`,
  path,
  title,
  content,
})

describe('normalizeTabPath', () => {
  test('collapses `.` and empty segments, keeps absolute', () => {
    expect(normalizeTabPath('/a/./b/c.ts')).toBe('/a/b/c.ts')
    expect(normalizeTabPath('/a//b')).toBe('/a/b')
    expect(normalizeTabPath('/a/b/')).toBe('/a/b')
  })
  test('resolves `..`', () => {
    expect(normalizeTabPath('/a/b/../c.ts')).toBe('/a/c.ts')
    expect(normalizeTabPath('/a/b/../../c.ts')).toBe('/c.ts')
  })
  test('preserves relative + leading `..`', () => {
    expect(normalizeTabPath('a/b')).toBe('a/b')
    expect(normalizeTabPath('../a')).toBe('../a')
  })
  test('is case-preserving (never folds case)', () => {
    expect(normalizeTabPath('/A.ts')).not.toBe(normalizeTabPath('/a.ts'))
  })
  test('empty stays empty', () => {
    expect(normalizeTabPath('')).toBe('')
  })
})

describe('resolveTabIdentity — path tier', () => {
  test('equal normalized absolute paths match at `path`', () => {
    expect(resolveTabIdentity(file('/repo/a.ts'), file('/repo/./a.ts'))).toBe('path')
    expect(resolveTabIdentity(file('/repo/x/../a.ts'), file('/repo/a.ts'))).toBe('path')
  })
  test('different files in different dirs never match (no false merge)', () => {
    expect(resolveTabIdentity(file('/a/foo.ts'), file('/b/foo.ts'))).toBeNull()
  })
  test('different files in the same dir do not match', () => {
    expect(resolveTabIdentity(file('/a/foo.ts', 'foo.ts'), file('/a/bar.ts', 'bar.ts'))).toBeNull()
  })
})

describe('resolveTabIdentity — directory-compatibility guardrail', () => {
  test('a path-backed tab NEVER merges with a path-less one (one-has-path)', () => {
    // Same basename, but one has a path and the other does not → never merge.
    expect(
      resolveTabIdentity(file('/a/report.pdf', 'report.pdf'), file(undefined, 'report.pdf')),
    ).toBeNull()
  })
  test('two path-less items with the same title match at `basename`', () => {
    expect(resolveTabIdentity(file(undefined, 'report.pdf'), file(undefined, 'report.pdf'))).toBe(
      'basename',
    )
  })
  test('same file via a `.` segment matches at `path`', () => {
    expect(resolveTabIdentity(file('/a/./x.ts'), file('/a/x.ts'))).toBe('path')
  })
  test('two path-backed files with the same title but different paths never merge', () => {
    // Even with an identical title, distinct paths are distinct documents — the
    // title/content tiers only apply to path-less buffers.
    expect(resolveTabIdentity(file('/a/x.ts', 'shared'), file('/b/x.ts', 'shared'))).toBeNull()
  })
})

describe('resolveTabIdentity — content tier', () => {
  test('content tier folds two path-less identical buffers', () => {
    const a: TabIdentity = { kind: 'file', id: 'a', title: 'A', content: 'hello' }
    const b: TabIdentity = { kind: 'file', id: 'b', title: 'B', content: 'hello' }
    expect(resolveTabIdentity(a, b)).toBe('content')
  })
  test('content over the cap is not compared', () => {
    const big = 'x'.repeat(TAB_IDENTITY_CONTENT_CAP + 1)
    const a: TabIdentity = { kind: 'file', id: 'a', title: 'A', content: big }
    const b: TabIdentity = { kind: 'file', id: 'b', title: 'B', content: big }
    expect(resolveTabIdentity(a, b)).toBeNull()
  })
  test('unrelated path-less buffers do not match', () => {
    const a: TabIdentity = { kind: 'file', id: 'a', title: 'A', content: 'one' }
    const b: TabIdentity = { kind: 'file', id: 'b', title: 'B', content: 'two' }
    expect(resolveTabIdentity(a, b)).toBeNull()
  })
})

describe('tabIdentityOf', () => {
  test('extracts path/title/content from a WorkItem payload', () => {
    const item: WorkItem = {
      kind: 'file',
      id: 'file:/a.ts',
      title: 'a.ts',
      payload: { path: '/a.ts' },
    }
    expect(tabIdentityOf(item)).toEqual({
      kind: 'file',
      id: 'file:/a.ts',
      path: '/a.ts',
      title: 'a.ts',
      content: undefined,
    })
  })
  test('an empty path becomes undefined (path-less)', () => {
    const item: WorkItem = {
      kind: 'file',
      id: 'file:media:1',
      title: 'x.png',
      payload: { path: '', mediaId: '1' },
    }
    expect(tabIdentityOf(item).path).toBeUndefined()
  })
})
