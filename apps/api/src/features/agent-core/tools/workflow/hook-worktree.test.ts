import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { adoptHookWorktree, resolveHookPath } from './hook-worktree'
import type { GitRunner } from './worktree'

/**
 * A worktree a WorktreeCreate hook made, screened as Claude Code screens the path it returned,
 * and kept when the agent finishes: no git removal, no branch deleted.
 */
const tmp = tempDirPerTest('hook-worktree-')

/** A real folder layout: `repo/` (the chat's repository) and `outside/wt` beside it. */
function layout() {
  const base = realpathSync(tmp())
  const repo = path.join(base, 'repo')
  mkdirSync(path.join(repo, 'pkg'), { recursive: true })
  mkdirSync(path.join(base, 'outside', 'wt'), { recursive: true })
  return { base, repo }
}

function fakeGit(top: string | null) {
  const calls: string[] = []
  const git: GitRunner = async (cwd, args) => {
    calls.push(`${cwd}: ${args.join(' ')}`)
    if (args.join(' ') === 'rev-parse --show-toplevel' && top) return top
    throw new Error('not a repository')
  }
  return { git, calls }
}

describe('adoptHookWorktree', () => {
  test('a relative path resolves against the folder the hook ran in, . and .. collapsed', async () => {
    const { base, repo } = layout()
    const { git } = fakeGit(repo)
    const made = { ok: true as const, path: './../outside/./wt', cwd: repo }
    const worktree = await adoptHookWorktree(made, git)
    expect(worktree).toMatchObject({
      dir: path.join(base, 'outside', 'wt'),
      workingDir: path.join(base, 'outside', 'wt'),
      byHook: true,
    })
    expect(worktree.branch).toBeUndefined()
  })

  test('an absolute path with a . or .. segment is refused, naming it', async () => {
    const { base, repo } = layout()
    for (const [raw, segment] of [
      [`${base}/repo/../outside/wt`, '..'],
      [`${base}/./outside/wt`, '.'],
    ]) {
      await expect(
        adoptHookWorktree({ ok: true, path: raw!, cwd: repo }, fakeGit(repo).git),
      ).rejects.toThrow(`may not contain a "${segment}" segment`)
    }
  })

  test('a path through a symlink below the repository root is refused, naming the link', async () => {
    const { base, repo } = layout()
    symlinkSync(path.join(base, 'outside'), path.join(repo, 'escape'))
    const raw = path.join(repo, 'escape', 'wt')
    await expect(
      adoptHookWorktree({ ok: true, path: raw, cwd: repo }, fakeGit(repo).git),
    ).rejects.toThrow(`${path.join(repo, 'escape')} is a symlink inside the repository`)
    // A symlink outside the repository is followed.
    symlinkSync(path.join(base, 'outside'), path.join(base, 'alias'))
    const aliased = path.join(base, 'alias', 'wt')
    const worktree = await adoptHookWorktree(
      { ok: true, path: aliased, cwd: repo },
      fakeGit(repo).git,
    )
    expect(worktree.dir).toBe(aliased)
  })

  test('outside git there is no repository root to screen below', async () => {
    const { base, repo } = layout()
    symlinkSync(path.join(base, 'outside'), path.join(repo, 'svn-link'))
    const raw = path.join(repo, 'svn-link', 'wt')
    const worktree = await adoptHookWorktree({ ok: true, path: raw, cwd: repo }, fakeGit(null).git)
    expect(worktree.dir).toBe(raw)
  })

  test('the path must be a folder Localix can enter', async () => {
    const { base, repo } = layout()
    const missing = path.join(base, 'missing')
    await expect(
      adoptHookWorktree({ ok: true, path: missing, cwd: repo }, fakeGit(repo).git),
    ).rejects.toThrow(`${missing} is not a folder Localix can enter`)
    const locked = path.join(base, 'outside', 'wt')
    chmodSync(locked, 0o600)
    try {
      if (process.getuid?.() !== 0)
        await expect(
          adoptHookWorktree({ ok: true, path: locked, cwd: repo }, fakeGit(repo).git),
        ).rejects.toThrow('not a folder Localix can enter')
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  test("the hook's failure fails the creation with its error", async () => {
    await expect(
      adoptHookWorktree({ ok: false, error: 'a WorktreeCreate hook failed: no svn' }),
    ).rejects.toThrow('isolation: a WorktreeCreate hook failed: no svn')
  })

  test('kept when the agent finishes, with nothing run on it', async () => {
    const { base, repo } = layout()
    const { git, calls } = fakeGit(repo)
    const raw = path.join(base, 'outside', 'wt')
    const worktree = await adoptHookWorktree({ ok: true, path: raw, cwd: repo }, git)
    const before = calls.length
    expect(await worktree.finish()).toEqual({ kept: true })
    expect(calls.length).toBe(before)
  })
})

test('resolveHookPath keeps a clean absolute path and resolves a relative one', () => {
  expect(resolveHookPath('/srv/wt/a', '/repo')).toBe('/srv/wt/a')
  expect(resolveHookPath('wt/../b', '/repo')).toBe('/repo/b')
})
