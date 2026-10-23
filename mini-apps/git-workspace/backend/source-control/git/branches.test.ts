import { describe, expect, test } from 'bun:test'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { createBranch, deleteBranch, parseAheadBehind, renameBranch } from './branches'
import type { GitResult, GitRunner } from './cli'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stderr: string): GitResult => ({ ok: false, stdout: '', stderr, code: 1 })

/** A GitRunner that records the args it was called with and replays a queued result. */
function fakeRunner(result: GitResult): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return { run: async (args) => (calls.push(args), result), calls }
}

describe('parseAheadBehind (upstream:track,nobracket parse)', () => {
  test('ahead and behind together', () => {
    expect(parseAheadBehind('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1 })
  })
  test('ahead only', () => {
    expect(parseAheadBehind('ahead 3')).toEqual({ ahead: 3, behind: 0 })
  })
  test('behind only', () => {
    expect(parseAheadBehind('behind 4')).toEqual({ ahead: 0, behind: 4 })
  })
  test('in sync / no upstream (empty) and gone → zeros', () => {
    expect(parseAheadBehind('')).toEqual({ ahead: 0, behind: 0 })
    expect(parseAheadBehind(undefined)).toEqual({ ahead: 0, behind: 0 })
    expect(parseAheadBehind('gone')).toEqual({ ahead: 0, behind: 0 })
  })
})

describe('createBranch (arg shape + errors)', () => {
  test('runs `git checkout -b <name>`', async () => {
    const { run, calls } = fakeRunner(ok())
    await createBranch(run, 'feature/x')
    expect(calls[0]).toEqual(['checkout', '-b', 'feature/x'])
  })

  test("surfaces git's first stderr line as a 409", async () => {
    const { run } = fakeRunner(fail("fatal: a branch named 'feature/x' already exists\n"))
    let caught: unknown
    try {
      await createBranch(run, 'feature/x')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).message).toBe("fatal: a branch named 'feature/x' already exists")
  })
})

describe('renameBranch (arg shape + errors)', () => {
  test('runs `git branch -m <from> <to>`', async () => {
    const { run, calls } = fakeRunner(ok())
    await renameBranch(run, 'old', 'new')
    expect(calls[0]).toEqual(['branch', '-m', 'old', 'new'])
  })

  test('surfaces a 409 when the target name already exists', async () => {
    const { run } = fakeRunner(fail("fatal: a branch named 'new' already exists\n"))
    let caught: unknown
    try {
      await renameBranch(run, 'old', 'new')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })
})

describe('deleteBranch (arg shape + errors)', () => {
  test('runs `git branch -d <name>` without force', async () => {
    const { run, calls } = fakeRunner(ok())
    await deleteBranch(run, 'old', false)
    expect(calls[0]).toEqual(['branch', '-d', 'old'])
  })

  test('runs `git branch -D <name>` with force', async () => {
    const { run, calls } = fakeRunner(ok())
    await deleteBranch(run, 'old', true)
    expect(calls[0]).toEqual(['branch', '-D', 'old'])
  })

  test('maps a not-fully-merged failure to the git_branch_not_merged code', async () => {
    const { run } = fakeRunner(fail("error: The branch 'old' is not fully merged.\n"))
    let caught: unknown
    try {
      await deleteBranch(run, 'old', false)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).code).toBe('git_branch_not_merged')
  })

  test('a forced delete that still fails is a plain delete failure (not the merge code)', async () => {
    const { run } = fakeRunner(fail("error: The branch 'old' is not fully merged.\n"))
    let caught: unknown
    try {
      await deleteBranch(run, 'old', true)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_branch_delete_failed')
  })
})

// --- Real-git integration (temp repo) ----------------------------------------
