import { describe, expect, test } from 'bun:test'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { applyStash, createStash, dropStash, showStash } from './stash'
import type { GitResult, GitRunner } from './cli'

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
