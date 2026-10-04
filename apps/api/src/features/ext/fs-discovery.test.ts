import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { confineToDir, listSubdirs, mergeByPrecedence, pathExists } from './fs-discovery'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'fs-discovery-test-'))
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// pathExists
// ---------------------------------------------------------------------------
describe('pathExists', () => {
  test('returns true for an existing file', async () => {
    const file = join(tmp, 'hello.txt')
    await writeFile(file, 'hi')
    expect(await pathExists(file)).toBe(true)
  })

  test('returns true for an existing directory', async () => {
    const dir = join(tmp, 'subdir')
    await mkdir(dir)
    expect(await pathExists(dir)).toBe(true)
  })

  test('returns false for a missing path', async () => {
    expect(await pathExists(join(tmp, 'does-not-exist'))).toBe(false)
  })

  test('returns false for a deeply missing path', async () => {
    expect(await pathExists(join(tmp, 'a', 'b', 'c'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listSubdirs
// ---------------------------------------------------------------------------
describe('listSubdirs', () => {
  test('returns names of immediate subdirectories', async () => {
    await mkdir(join(tmp, 'alpha'))
    await mkdir(join(tmp, 'beta'))
    await writeFile(join(tmp, 'file.txt'), '')
    const result = await listSubdirs(tmp)
    expect(result.sort()).toEqual(['alpha', 'beta'])
  })

  test('excludes files — only directories', async () => {
    await writeFile(join(tmp, 'only-file.txt'), '')
    const result = await listSubdirs(tmp)
    expect(result).toEqual([])
  })

  test('returns [] for a missing directory (no throw)', async () => {
    const missing = join(tmp, 'no-such-dir')
    const result = await listSubdirs(missing)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// confineToDir
// ---------------------------------------------------------------------------
describe('confineToDir', () => {
  test('returns abs path for a relative path inside the root', () => {
    // `string | null`: confineToDir now returns a branded ContainedPath; this test asserts
    // its string VALUE, so widening to the base type is the honest annotation.
    const result: string | null = confineToDir(tmp, 'sub/file.js')
    expect(result).toBe(join(tmp, 'sub', 'file.js'))
  })

  test('returns the root itself when relPath is "."', () => {
    const result: string | null = confineToDir(tmp, '.')
    expect(result).toBe(tmp)
  })

  test('returns null for a path that escapes via ..', () => {
    const result = confineToDir(tmp, '../escape')
    expect(result).toBeNull()
  })

  test('returns null for an absolute path outside the root', () => {
    const result = confineToDir(tmp, '/etc/passwd')
    expect(result).toBeNull()
  })

  test('returns abs path for an absolute path inside the root', () => {
    const inside = join(tmp, 'deep', 'file.mjs')
    const result: string | null = confineToDir(tmp, inside)
    expect(result).toBe(inside)
  })

  test('sibling-prefix attack: /a/rootX is NOT inside /a/root', () => {
    // Construct a sibling that shares a prefix with tmp.
    // e.g. if tmp = /tmp/abc, sibling = /tmp/abcEXTRA
    const parent = join(tmp, '..')
    const rootName = tmp.split(sep).at(-1)!
    const sibling = join(parent, rootName + 'EXTRA')
    // confineToDir(tmp, sibling) must return null because sibling !== tmp
    // and sibling does NOT start with tmp + sep.
    const result = confineToDir(tmp, sibling)
    expect(result).toBeNull()
  })

  test('a deeply nested relative path resolves correctly', () => {
    const result: string | null = confineToDir(tmp, 'a/b/c/d.ts')
    expect(result).toBe(join(tmp, 'a', 'b', 'c', 'd.ts'))
  })
})

describe('mergeByPrecedence', () => {
  const item = (name: string, tag: string) => ({ manifest: { name }, tag })

  test('first batch wins on a name clash (precedence order)', () => {
    const merged = mergeByPrecedence([
      [item('a', 'project'), item('b', 'project')],
      [item('a', 'global'), item('c', 'global')],
      [item('a', 'bundled'), item('b', 'bundled'), item('c', 'bundled')],
    ])
    expect(merged.map((m) => `${m.manifest.name}:${m.tag}`)).toEqual([
      'a:project',
      'b:project',
      'c:global',
    ])
  })

  test('result is sorted by name regardless of input order', () => {
    const merged = mergeByPrecedence([[item('zeta', 'x'), item('alpha', 'x'), item('mid', 'x')]])
    expect(merged.map((m) => m.manifest.name)).toEqual(['alpha', 'mid', 'zeta'])
  })

  test('empty input yields an empty list', () => {
    expect(mergeByPrecedence([])).toEqual([])
    expect(mergeByPrecedence([[], []])).toEqual([])
  })
})
