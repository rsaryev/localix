import { describe, expect, it } from 'bun:test'
import type { DirEntry } from '@/shared/api/contracts'
import { filterFileTree } from './fileTreeFilter'

const dir = (name: string): DirEntry => ({ name, type: 'dir' }) as DirEntry
const file = (name: string): DirEntry => ({ name, type: 'file' }) as DirEntry

// A small loaded tree:
//   /p
//     src/            (dir)
//       index.ts      (file)
//       util/         (dir)
//         helpers.ts  (file)
//     README.md       (file)
const tree: Record<string, DirEntry[]> = {
  '/p': [dir('src'), file('README.md')],
  '/p/src': [file('index.ts'), dir('util')],
  '/p/src/util': [file('helpers.ts')],
}

describe('filterFileTree', () => {
  it('returns null for a blank query or missing root', () => {
    expect(filterFileTree('/p', tree, '')).toBeNull()
    expect(filterFileTree('/p', tree, '   ')).toBeNull()
    expect(filterFileTree(null, tree, 'x')).toBeNull()
  })

  it('matches a file by name and keeps its ancestor folders visible + expanded', () => {
    const r = filterFileTree('/p', tree, 'helpers')!
    expect(r.matchCount).toBe(1)
    expect(r.visible.has('/p/src/util/helpers.ts')).toBe(true)
    expect(r.visible.has('/p/src/util')).toBe(true)
    expect(r.visible.has('/p/src')).toBe(true)
    // Ancestors of the match are force-opened…
    expect(r.expand.has('/p/src')).toBe(true)
    expect(r.expand.has('/p/src/util')).toBe(true)
    // …but the non-matching sibling is hidden.
    expect(r.visible.has('/p/README.md')).toBe(false)
    expect(r.visible.has('/p/src/index.ts')).toBe(false)
  })

  it('is case-insensitive and substring-based', () => {
    const r = filterFileTree('/p', tree, 'INDEX')!
    expect(r.visible.has('/p/src/index.ts')).toBe(true)
    expect(r.matchCount).toBe(1)
  })

  it('a folder matched by name reveals its whole subtree (showAllUnder)', () => {
    const r = filterFileTree('/p', tree, 'util')!
    expect(r.visible.has('/p/src/util')).toBe(true)
    expect(r.showAllUnder.has('/p/src/util')).toBe(true)
    // A name-matched folder is not itself force-expanded (it shows collapsed),
    // but its ancestor is opened so it's reachable.
    expect(r.expand.has('/p/src')).toBe(true)
  })

  it('only considers loaded directories (never-expanded folders contribute nothing)', () => {
    const partial: Record<string, DirEntry[]> = { '/p': [dir('src'), file('README.md')] }
    const r = filterFileTree('/p', partial, 'helpers')!
    expect(r.matchCount).toBe(0)
    expect(r.visible.size).toBe(0)
  })
})
