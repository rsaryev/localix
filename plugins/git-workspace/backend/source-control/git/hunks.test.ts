import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@localixai/plugin-sdk/backend'
import { gitRunner, type GitRunner } from './cli'
import { getFileHunks, parseUnifiedHunks, revertHunk } from './hunks'

describe('parseUnifiedHunks', () => {
  test('splits the file header from hunks and keeps body prefixes', () => {
    const diff = [
      'diff --git a/f.txt b/f.txt',
      'index f62562a..89026df 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -2 +2 @@ line1',
      '-line2',
      '+CHANGED2',
      '@@ -4,0 +5 @@ line4',
      '+ADDEDX',
      '@@ -7 +7,0 @@ line6',
      '-line7',
      '',
    ].join('\n')
    const { fileHeader, hunks } = parseUnifiedHunks(diff)
    expect(fileHeader).toBe(
      'diff --git a/f.txt b/f.txt\nindex f62562a..89026df 100644\n--- a/f.txt\n+++ b/f.txt',
    )
    expect(hunks).toHaveLength(3)
    expect(hunks[0]).toMatchObject({
      header: '@@ -2 +2 @@ line1',
      newStart: 2,
      newCount: 1,
      body: ['-line2', '+CHANGED2'],
    })
    expect(hunks[1]).toMatchObject({
      header: '@@ -4,0 +5 @@ line4',
      newStart: 5,
      newCount: 1,
      body: ['+ADDEDX'],
    })
    // A pure deletion carries newCount 0.
    expect(hunks[2]).toMatchObject({
      header: '@@ -7 +7,0 @@ line6',
      newStart: 7,
      newCount: 0,
      body: ['-line7'],
    })
  })

  test('empty diff yields no hunks', () => {
    expect(parseUnifiedHunks('').hunks).toHaveLength(0)
  })
})

// --- Real-git integration (temp repo) ----------------------------------------

describe('getFileHunks + revertHunk (real git)', () => {
  let dir: string
  let run: GitRunner

  const write = (content: string) => writeFile(join(dir, 'f.txt'), content, 'utf8')
  const read = () => readFile(join(dir, 'f.txt'), 'utf8')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-hunks-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    await write('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'init'])
    // Three separate changes: modify line2, add after line4, delete line7.
    await write('line1\nCHANGED2\nline3\nline4\nADDEDX\nline5\nline6\nline8\n')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('exposes one gutter-aligned hunk per contiguous change', async () => {
    const hunks = await getFileHunks(run, 'f.txt')
    expect(hunks).toHaveLength(3)
    // modify at line 2
    expect(hunks[0]).toMatchObject({
      index: 0,
      modifiedStart: 2,
      modifiedEnd: 2,
      oldLines: ['line2'],
      newLines: ['CHANGED2'],
    })
    // add at line 5
    expect(hunks[1]).toMatchObject({
      index: 1,
      modifiedStart: 5,
      modifiedEnd: 5,
      oldLines: [],
      newLines: ['ADDEDX'],
    })
    // pure deletion of line7 anchors on the surviving line above it (line 6)
    expect(hunks[2]).toMatchObject({
      index: 2,
      modifiedStart: 6,
      modifiedEnd: 6,
      oldLines: ['line7'],
      newLines: [],
    })
  })

  test('reverts only the targeted add hunk, leaving the others', async () => {
    const hunks = await getFileHunks(run, 'f.txt')
    await revertHunk(run, dir, { path: 'f.txt', index: 1, header: hunks[1].header })
    // ADDEDX gone; CHANGED2 and the line7 deletion untouched.
    expect(await read()).toBe('line1\nCHANGED2\nline3\nline4\nline5\nline6\nline8\n')
  })

  test('reverts a pure deletion (restores the removed line)', async () => {
    const hunks = await getFileHunks(run, 'f.txt')
    await revertHunk(run, dir, { path: 'f.txt', index: 2, header: hunks[2].header })
    expect(await read()).toBe('line1\nCHANGED2\nline3\nline4\nADDEDX\nline5\nline6\nline7\nline8\n')
  })

  test('reverts a modification (restores the original line)', async () => {
    const hunks = await getFileHunks(run, 'f.txt')
    await revertHunk(run, dir, { path: 'f.txt', index: 0, header: hunks[0].header })
    expect(await read()).toBe('line1\nline2\nline3\nline4\nADDEDX\nline5\nline6\nline8\n')
  })

  test('refuses with a 409 when the header no longer matches (drift guard)', async () => {
    let caught: unknown
    try {
      await revertHunk(run, dir, { path: 'f.txt', index: 0, header: '@@ -99 +99 @@ stale' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })

  test('untracked file yields no hunks', async () => {
    await writeFile(join(dir, 'new.txt'), 'brand new\n', 'utf8')
    expect(await getFileHunks(run, 'new.txt')).toHaveLength(0)
  })
})
