import { describe, expect, test } from 'bun:test'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import {
  checkoutCommit,
  cherryPick,
  createBranchAt,
  resetToCommit,
  revertCommit,
} from './commit-ops'
import type { GitResult, GitRunner } from './cli'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stdout: string, stderr: string): GitResult => ({ ok: false, stdout, stderr, code: 1 })

/** A GitRunner that records the args it was called with and replays a queued result. */
function fakeRunner(result: GitResult): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return { run: async (args) => (calls.push(args), result), calls }
}

describe('commit-ops (arg shape + error mapping)', () => {
  test('revertCommit runs `git revert --no-edit <hash>`', async () => {
    const { run, calls } = fakeRunner(ok())
    await revertCommit(run, 'abc123')
    expect(calls[0]).toEqual(['revert', '--no-edit', 'abc123'])
  })

  test('revertCommit maps a conflict to git_revert_conflict', async () => {
    const { run } = fakeRunner(
      fail('error: could not revert abc123\nCONFLICT (content): Merge conflict in f.txt\n', ''),
    )
    let caught: unknown
    try {
      await revertCommit(run, 'abc123')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
    expect((caught as ApiError).code).toBe('git_revert_conflict')
  })

  test('cherryPick runs `git cherry-pick <hash>` and maps a conflict', async () => {
    const { run, calls } = fakeRunner(ok())
    await cherryPick(run, 'def456')
    expect(calls[0]).toEqual(['cherry-pick', 'def456'])

    const conflict = fakeRunner(
      fail('', 'error: could not apply def456\nhint: after resolving the conflicts\n'),
    )
    let caught: unknown
    try {
      await cherryPick(conflict.run, 'def456')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_cherry_pick_conflict')
  })

  test('resetToCommit runs `git reset --<mode> <hash>` for each mode', async () => {
    for (const mode of ['soft', 'mixed', 'hard'] as const) {
      const { run, calls } = fakeRunner(ok())
      await resetToCommit(run, 'abc123', mode)
      expect(calls[0]).toEqual(['reset', `--${mode}`, 'abc123'])
    }
  })

  test('checkoutCommit runs `git checkout <hash>` and maps failure to git_checkout_failed', async () => {
    const { run, calls } = fakeRunner(ok())
    await checkoutCommit(run, 'abc123')
    expect(calls[0]).toEqual(['checkout', 'abc123'])

    const dirty = fakeRunner(fail('', 'error: Your local changes would be overwritten\n'))
    let caught: unknown
    try {
      await checkoutCommit(dirty.run, 'abc123')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_checkout_failed')
  })

  test('createBranchAt runs `git branch <name> <hash>` and maps failure', async () => {
    const { run, calls } = fakeRunner(ok())
    await createBranchAt(run, 'feature/x', 'abc123')
    expect(calls[0]).toEqual(['branch', 'feature/x', 'abc123'])

    const dup = fakeRunner(fail('', "fatal: a branch named 'feature/x' already exists\n"))
    let caught: unknown
    try {
      await createBranchAt(dup.run, 'feature/x', 'abc123')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_branch_create_failed')
  })
})

// --- Real-git integration (temp repo) ----------------------------------------
