import { describe, expect, test } from 'bun:test'
import type { DirEntry } from '@/shared/api/contracts'
import {
  canMoveInto,
  distinctParents,
  dirname,
  revealAncestors,
  computeCompactChain,
  compactExpandTargets,
} from './fileTreePaths'

const dir = (name: string): DirEntry => ({ name, type: 'dir' }) as DirEntry
const file = (name: string): DirEntry => ({ name, type: 'file' }) as DirEntry

describe('dirname', () => {
  test('returns the parent directory of a nested path', () => {
    expect(dirname('/a/b/c.ts')).toBe('/a/b')
  })

  test('a top-level path under root yields the root slash', () => {
    expect(dirname('/c.ts')).toBe('/')
  })

  test('a bare name (no slash) falls back to "/"', () => {
    expect(dirname('c.ts')).toBe('/')
  })
})

describe('canMoveInto', () => {
  test('rejects a move into the folder the entry already lives in (no-op)', () => {
    expect(canMoveInto('/p/a.ts', '/p')).toBe(false)
  })

  test('allows a move into a different folder', () => {
    expect(canMoveInto('/p/a.ts', '/p/sub')).toBe(true)
  })

  test('rejects dropping a folder onto itself', () => {
    expect(canMoveInto('/p/dir', '/p/dir')).toBe(false)
  })

  test('rejects dropping a folder into its own descendant', () => {
    expect(canMoveInto('/p/dir', '/p/dir/child')).toBe(false)
  })

  test('does not treat a sibling with a shared name prefix as a descendant', () => {
    expect(canMoveInto('/p/dir', '/p/dir2')).toBe(true)
  })

  test('allows moving a nested file up to the root', () => {
    expect(canMoveInto('/p/sub/a.ts', '/p')).toBe(true)
  })
})

describe('distinctParents', () => {
  test('drops paths nested under a selected ancestor folder', () => {
    expect(distinctParents(['/p/a', '/p/a/b.ts', '/p/c'])).toEqual(['/p/a', '/p/c'])
  })

  test('de-duplicates and sorts', () => {
    expect(distinctParents(['/p/z', '/p/a', '/p/a'])).toEqual(['/p/a', '/p/z'])
  })

  test('keeps siblings sharing a name prefix', () => {
    expect(distinctParents(['/p/dir', '/p/dir2/x.ts'])).toEqual(['/p/dir', '/p/dir2/x.ts'])
  })

  test('empty in, empty out', () => {
    expect(distinctParents([])).toEqual([])
  })
})

describe('revealAncestors', () => {
  test('lists each containing folder outermost-first, excluding the file', () => {
    expect(revealAncestors('/p', '/p/a/b/c.ts')).toEqual(['/p/a', '/p/a/b'])
  })

  test('a file directly under root has no ancestors to expand', () => {
    expect(revealAncestors('/p', '/p/c.ts')).toEqual([])
  })

  test('the root itself has no ancestors', () => {
    expect(revealAncestors('/p', '/p')).toEqual([])
  })

  test('returns null when the file is outside root (caller skips reveal)', () => {
    expect(revealAncestors('/p', '/other/x.ts')).toBeNull()
  })

  test('does not treat a sibling root-prefix as inside root', () => {
    // "/project2" must NOT be considered inside "/project" despite the prefix.
    expect(revealAncestors('/project', '/project2/x.ts')).toBeNull()
  })

  test('handles a deep path, accumulating absolute folder paths', () => {
    expect(revealAncestors('/root', '/root/src/features/inspector/ui/x.tsx')).toEqual([
      '/root/src',
      '/root/src/features',
      '/root/src/features/inspector',
      '/root/src/features/inspector/ui',
    ])
  })
})

describe('computeCompactChain', () => {
  test('folds a run of single-directory-child descendants into one chain', () => {
    const children: Record<string, DirEntry[]> = {
      '/p/src': [dir('main')],
      '/p/src/main': [dir('java')],
      '/p/src/main/java': [dir('com')],
      '/p/src/main/java/com': [file('A.java'), file('B.java')],
    }
    expect(computeCompactChain('/p/src', children)).toEqual([
      '/p/src',
      '/p/src/main',
      '/p/src/main/java',
      '/p/src/main/java/com', // tail: 2 children breaks the run (but is included)
    ])
  })

  test('breaks (excluding it) at a folder with two or more children', () => {
    const children: Record<string, DirEntry[]> = {
      '/p/src': [dir('main')],
      '/p/src/main': [dir('a'), dir('b')], // two dir children → main is the tail
    }
    expect(computeCompactChain('/p/src', children)).toEqual(['/p/src', '/p/src/main'])
  })

  test('breaks at a folder whose single child is a file (not a directory)', () => {
    const children: Record<string, DirEntry[]> = {
      '/p/src': [dir('main')],
      '/p/src/main': [file('index.ts')], // single child is a file → no fold past main
    }
    expect(computeCompactChain('/p/src', children)).toEqual(['/p/src', '/p/src/main'])
  })

  test('does not fold past a folder with unknown (unloaded) children', () => {
    const children: Record<string, DirEntry[]> = {
      '/p/src': [dir('main')], // /p/src/main not loaded → tail stays main
    }
    expect(computeCompactChain('/p/src', children)).toEqual(['/p/src', '/p/src/main'])
  })

  test('a head whose own children are unloaded does not fold at all', () => {
    expect(computeCompactChain('/p/src', {})).toEqual(['/p/src'])
  })

  test('a head with two children is a length-1 chain (no folding)', () => {
    const children: Record<string, DirEntry[]> = { '/p/src': [dir('a'), dir('b')] }
    expect(computeCompactChain('/p/src', children)).toEqual(['/p/src'])
  })

  test('an explicitly-expanded folder stops the chain so its children render there', () => {
    const children: Record<string, DirEntry[]> = {
      '/p/src': [dir('main')],
      '/p/src/main': [dir('java')],
      '/p/src/main/java': [dir('com')],
      '/p/src/main/java/com': [file('A.java'), file('B.java')],
    }
    // User drilled into `main` → fold stops there, `main`'s children render below.
    expect(computeCompactChain('/p/src', children, new Set(['/p/src/main']))).toEqual([
      '/p/src',
      '/p/src/main',
    ])
  })
})

describe('compactExpandTargets', () => {
  const children: Record<string, DirEntry[]> = {
    '/p/src': [dir('main')],
    '/p/src/main': [dir('java')],
    '/p/src/main/java': [dir('com')],
    '/p/src/main/java/com': [file('A.java'), file('B.java')],
  }

  test('reveals a file under a single-child chain by expanding only the chain tail', () => {
    // Naive reveal would expand src, main, java, com — un-folding the whole branch.
    expect(compactExpandTargets('/p', '/p/src/main/java/com/A.java', children)).toEqual([
      '/p/src/main/java/com',
    ])
  })

  test('expands each render boundary when the path is not one straight chain', () => {
    const mixed: Record<string, DirEntry[]> = {
      '/p/a': [dir('b'), file('note.txt')], // a has 2 children → boundary at a
      '/p/a/b': [dir('c')], // single dir child → folds b→c
      '/p/a/b/c': [file('x.ts')],
    }
    expect(compactExpandTargets('/p', '/p/a/b/c/x.ts', mixed)).toEqual(['/p/a', '/p/a/b/c'])
  })

  test('returns null when the file is outside root', () => {
    expect(compactExpandTargets('/p', '/other/x.ts', children)).toBeNull()
  })
})
