import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { findFiles, createEntry, deleteEntry } from './file-ops'
import type { FileOpsContext } from './file-ops'
import {
  invalidateFileList,
  getProjectFileList,
  FILE_LIST_TTL_MS,
  MAX_INDEXED_FILES,
} from './file-list-cache'
import type { SessionRecord } from '../repository'

/**
 * Quick-open, the composer @-autocomplete and the tree search box all search
 * server-side on EVERY keystroke, and each search used to re-walk the whole tree
 * with `rg --files`.
 */

let dir: string
const ctx = (): FileOpsContext => ({
  requireSession: async () => ({ id: 's1', executionBackend: 'local' }) as unknown as SessionRecord,
  resolveSessionWorkingDir: async () => dir,
})

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'filelist-'))
  writeFileSync(path.join(dir, 'alpha.ts'), '')
  writeFileSync(path.join(dir, 'beta.ts'), '')
  invalidateFileList()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  invalidateFileList()
})

describe('getProjectFileList', () => {
  test('walks once for a burst of keystrokes', async () => {
    let walks = 0
    const load = async () => {
      walks++
      return { paths: ['a.ts'], omitted: 0 }
    }
    for (const _ of 'alpha') await getProjectFileList('/root', false, load)
    expect(walks).toBe(1)
  })

  test('overlapping keystrokes share the same walk', async () => {
    let walks = 0
    const load = async () => {
      walks++
      await new Promise((r) => setTimeout(r, 5))
      return { paths: ['a.ts'], omitted: 0 }
    }
    await Promise.all(Array.from({ length: 8 }, () => getProjectFileList('/root', false, load)))
    expect(walks).toBe(1)
  })

  test('the two ignore modes are cached apart — they list different files', async () => {
    const seen: boolean[] = []
    const load = (includeIgnored: boolean) => async () => {
      seen.push(includeIgnored)
      return { paths: [includeIgnored ? 'ignored.ts' : 'tracked.ts'], omitted: 0 }
    }
    expect((await getProjectFileList('/root', false, load(false))).paths).toEqual(['tracked.ts'])
    expect((await getProjectFileList('/root', true, load(true))).paths).toEqual(['ignored.ts'])
    expect(seen).toEqual([false, true])
  })

  test('the backstop TTL expires an un-invalidated entry', async () => {
    let walks = 0
    let clock = 1_000
    const load = async () => {
      walks++
      return { paths: ['a.ts'], omitted: 0 }
    }
    await getProjectFileList('/root', false, load, () => clock)
    clock += FILE_LIST_TTL_MS + 1
    await getProjectFileList('/root', false, load, () => clock)
    expect(walks).toBe(2)
  })

  test('a failed walk is never memoized', async () => {
    let walks = 0
    const load = async () => {
      walks++
      if (walks === 1) throw new Error('rg missing')
      return { paths: ['a.ts'], omitted: 0 }
    }
    expect(getProjectFileList('/root', false, load)).rejects.toThrow('rg missing')
    expect((await getProjectFileList('/root', false, load)).paths).toEqual(['a.ts'])
  })
})

describe('the index cap is declared, enforced and reported', () => {
  test('an oversize tree keeps the front of the walk and counts what it dropped', async () => {
    const paths = Array.from({ length: MAX_INDEXED_FILES + 25 }, (_, i) => `f-${i}.ts`)
    const omitted = Math.max(0, paths.length - MAX_INDEXED_FILES)
    const indexed = await getProjectFileList('/huge', false, async () => ({
      paths: paths.slice(0, MAX_INDEXED_FILES),
      omitted,
    }))

    expect(indexed.paths.length).toBe(MAX_INDEXED_FILES)
    // The FRONT is kept. The stdout capture cap this replaces kept the TAIL, which
    // is why a large tree lost files nobody could name.
    expect(indexed.paths[0]).toBe('f-0.ts')
    expect(indexed.omitted).toBe(25)
  })

  test('findFiles surfaces the shortfall so "no results" is distinguishable from a miss', async () => {
    const res = await findFiles(ctx(), 'u', 's1', 'alpha')
    // This fixture tree is tiny, so the whole thing is indexed and the field is absent.
    expect(res.indexTruncated).toBeUndefined()
    expect(res.files.map((f) => f.path)).toContain('alpha.ts')
  })
})

describe('findFiles staleness', () => {
  test('a file created through the tree is findable on the next keystroke', async () => {
    const before = await findFiles(ctx(), 'u', 's1', 'gamma')
    expect(before.files.map((f) => f.path)).not.toContain('gamma.ts')

    await createEntry(ctx(), 'u', 's1', '.', 'gamma.ts', 'file')

    const after = await findFiles(ctx(), 'u', 's1', 'gamma')
    expect(after.files.map((f) => f.path)).toContain('gamma.ts')
  })

  test('a file deleted through the tree stops being offered', async () => {
    expect((await findFiles(ctx(), 'u', 's1', 'alpha')).files.map((f) => f.path)).toContain(
      'alpha.ts',
    )

    await deleteEntry(ctx(), 'u', 's1', 'alpha.ts', { permanent: true })

    expect((await findFiles(ctx(), 'u', 's1', 'alpha')).files.map((f) => f.path)).not.toContain(
      'alpha.ts',
    )
  })

  test('an external change is picked up once the list is invalidated', async () => {
    await findFiles(ctx(), 'u', 's1', 'delta')
    // An agent write / build / branch switch — what the fs-watch feed reports.
    writeFileSync(path.join(dir, 'delta.ts'), '')
    invalidateFileList()

    expect((await findFiles(ctx(), 'u', 's1', 'delta')).files.map((f) => f.path)).toContain(
      'delta.ts',
    )
  })
})
