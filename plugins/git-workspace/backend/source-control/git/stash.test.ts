import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@localixai/plugin-sdk/backend'
import { applyStash, createStash, dropStash, listStashes, showStash } from './stash'
import { gitRunner, type GitResult, type GitRunner } from './cli'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stderr: string, stdout = ''): GitResult => ({ ok: false, stdout, stderr, code: 1 })

/** A GitRunner that records the args it was called with and replays a queued result. */
function fakeRunner(result: GitResult): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return { run: async (args) => (calls.push(args), result), calls }
}

describe('createStash (arg shape + errors)', () => {
  test('includes untracked (-u) and a message by default', async () => {
    const { run, calls } = fakeRunner(ok())
    await createStash(run, { message: 'wip login', includeUntracked: true })
    expect(calls[0]).toEqual(['stash', 'push', '-u', '-m', 'wip login'])
  })

  test('omits -u and -m when not requested', async () => {
    const { run, calls } = fakeRunner(ok())
    await createStash(run, { includeUntracked: false })
    expect(calls[0]).toEqual(['stash', 'push'])
  })

  test('maps "No local changes to save" to a distinct code', async () => {
    const { run } = fakeRunner(fail('No local changes to save\n'))
    let caught: unknown
    try {
      await createStash(run, { includeUntracked: true })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('git_stash_no_changes')
  })
})

describe('applyStash (arg shape + errors)', () => {
  test('pop removes the entry (`stash pop stash@{N}`)', async () => {
    const { run, calls } = fakeRunner(ok())
    await applyStash(run, 2, true)
    expect(calls[0]).toEqual(['stash', 'pop', 'stash@{2}'])
  })

  test('apply keeps the entry (`stash apply stash@{N}`)', async () => {
    const { run, calls } = fakeRunner(ok())
    await applyStash(run, 0, false)
    expect(calls[0]).toEqual(['stash', 'apply', 'stash@{0}'])
  })

  test('maps a conflict to git_stash_conflict', async () => {
    const { run } = fakeRunner(fail('', 'CONFLICT (content): Merge conflict in f.txt\n'))
    let caught: unknown
    try {
      await applyStash(run, 0, false)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_stash_conflict')
  })

  test('maps a missing stash to git_stash_not_found', async () => {
    const { run } = fakeRunner(
      fail("fatal: log for 'stash' only has 0 entries\nstash@{0} is not a valid reference"),
    )
    let caught: unknown
    try {
      await applyStash(run, 0, true)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_stash_not_found')
  })
})

describe('dropStash (arg shape)', () => {
  test('drops by index (`stash drop stash@{N}`)', async () => {
    const { run, calls } = fakeRunner(ok())
    await dropStash(run, 1)
    expect(calls[0]).toEqual(['stash', 'drop', 'stash@{1}'])
  })
})

describe('showStash (arg shape + shape)', () => {
  test('requests the patch (`stash show -p stash@{N}`)', async () => {
    const { run, calls } = fakeRunner(ok('diff --git a/f.txt b/f.txt\n'))
    const res = await showStash(run, 2)
    expect(calls[0]).toEqual(['stash', 'show', '-p', '--include-untracked', 'stash@{2}'])
    expect(res.path).toBe('stash@{2}')
    expect(res.diff).toContain('diff --git')
    expect(res.binary).toBe(false)
  })

  test('flags a binary patch', async () => {
    const { run } = fakeRunner(ok('Binary files a/x.png and b/x.png differ\n'))
    expect((await showStash(run, 0)).binary).toBe(true)
  })

  test('an overflow keeps its complete files, flags truncated, and does NOT retry', async () => {
    const whole = 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
    const { run, calls } = fakeRunner({
      ...fail(''),
      stdout: `${whole}diff --git a/b.txt b/b.txt\n+cut`,
      truncated: true,
    })
    const res = await showStash(run, 0)
    // The retry used to fire on the overflow too and come back empty.
    expect(calls).toHaveLength(1)
    expect(res).toEqual({ path: 'stash@{0}', diff: whole, binary: false, truncated: true })
  })

  test('a failed run yields an empty diff (tolerant, like getCommitShow)', async () => {
    const { run } = fakeRunner(fail('fatal: bad revision'))
    const res = await showStash(run, 9)
    expect(res.diff).toBe('')
    expect(res.path).toBe('stash@{9}')
  })
})

// --- Real-git integration (temp repo) ----------------------------------------

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
