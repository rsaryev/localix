import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiError } from '@localixai/mini-app-sdk/backend'
import { applyStash, createStash, dropStash, listStashes, showStash } from './stash'
import { gitRunner, type GitRunner } from './cli'

describe('stash lifecycle (real git)', () => {
  let dir: string
  let run: GitRunner

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-stash-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    await run(['checkout', '-q', '-b', 'main'])
    await writeFile(join(dir, 'f.txt'), 'x\n', 'utf8')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'init'])
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('push → list → pop round-trips a working change', async () => {
    await writeFile(join(dir, 'f.txt'), 'x\nchanged\n', 'utf8')
    await createStash(run, { message: 'my wip', includeUntracked: true })
    // Working tree is clean after a stash.
    expect((await run(['status', '--porcelain'])).stdout.trim()).toBe('')

    const list = await listStashes(run)
    expect(list.length).toBe(1)
    expect(list[0]?.index).toBe(0)
    expect(list[0]?.message).toContain('my wip')
    expect(list[0]?.branch).toBe('main')

    await applyStash(run, 0, true) // pop
    expect((await run(['status', '--porcelain'])).stdout.trim()).not.toBe('')
    expect(await listStashes(run)).toHaveLength(0) // pop removed it
  })

  test('includes untracked files in the stash', async () => {
    await writeFile(join(dir, 'new.txt'), 'brand new\n', 'utf8')
    await createStash(run, { includeUntracked: true })
    expect((await run(['status', '--porcelain'])).stdout.trim()).toBe('')
    await applyStash(run, 0, false) // apply keeps it
    expect((await run(['status', '--porcelain'])).stdout).toContain('new.txt')
    expect(await listStashes(run)).toHaveLength(1) // apply kept it
  })

  test('drop discards a stash without restoring it', async () => {
    await writeFile(join(dir, 'f.txt'), 'x\ndrop me\n', 'utf8')
    await createStash(run, { includeUntracked: false })
    await dropStash(run, 0)
    expect(await listStashes(run)).toHaveLength(0)
    expect((await run(['status', '--porcelain'])).stdout.trim()).toBe('') // not restored
  })

  test('refuses to stash a clean tree with a distinct code', async () => {
    let caught: unknown
    try {
      await createStash(run, { includeUntracked: true })
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_stash_no_changes')
  })

  test('showStash returns the patch of a stashed change', async () => {
    await writeFile(join(dir, 'f.txt'), 'x\nshow me\n', 'utf8')
    await createStash(run, { message: 'to show', includeUntracked: false })
    const diff = await showStash(run, 0)
    expect(diff.path).toBe('stash@{0}')
    expect(diff.diff).toContain('diff --git')
    expect(diff.diff).toContain('show me')
    expect(diff.binary).toBe(false)
  })

  test('lists stashes newest-first with sequential indices', async () => {
    await writeFile(join(dir, 'f.txt'), 'x\nfirst\n', 'utf8')
    await createStash(run, { message: 'first', includeUntracked: false })
    await writeFile(join(dir, 'f.txt'), 'x\nsecond\n', 'utf8')
    await createStash(run, { message: 'second', includeUntracked: false })
    const list = await listStashes(run)
    expect(list.map((s) => s.index)).toEqual([0, 1])
    expect(list[0]?.message).toContain('second') // newest first
  })
})
