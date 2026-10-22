import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { runSync, scratchGitEnv, tempDirPerTest } from '@localixai/testing'

import { createAgentWorktree, createGitRunner } from './worktree'

/**
 * The same worktree on real git: an agent that changes nothing leaves nothing behind, and one that
 * edits keeps its worktree and branch, with the main checkout untouched.
 */
const dir = tempDirPerTest('workflow-worktree-')

function repo(): { root: string; worktrees: string } {
  const root = path.join(dir(), 'repo')
  mkdirSync(path.join(root, 'pkg'), { recursive: true })
  writeFileSync(path.join(root, 'pkg', 'a.ts'), 'export const a = 1\n')
  const env = scratchGitEnv()
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'init'],
  ])
    expect(runSync('git', args, { cwd: root, env }).code).toBe(0)
  return { root, worktrees: path.join(dir(), 'worktrees') }
}

const git = () => createGitRunner(scratchGitEnv() as NodeJS.ProcessEnv)

describe('createAgentWorktree on git', () => {
  test('an unchanged worktree is removed with its branch', async () => {
    const { root, worktrees } = repo()
    const worktree = await createAgentWorktree({
      cwd: path.join(root, 'pkg'),
      name: 'wf-000000000001-1',
      group: 'root',
      root: worktrees,
      git: git(),
    })
    expect(existsSync(path.join(worktree.workingDir, 'a.ts'))).toBe(true)
    expect(await worktree.finish()).toEqual({ kept: false })
    expect(existsSync(worktree.dir)).toBe(false)
    const branches = runSync('git', ['branch', '--list', 'localix/*'], {
      cwd: root,
      env: scratchGitEnv(),
    })
    expect(branches.stdout.trim()).toBe('')
  })

  test('an edited worktree is kept; the main checkout does not change', async () => {
    const { root, worktrees } = repo()
    const worktree = await createAgentWorktree({
      cwd: root,
      name: 'wf-000000000001-2',
      group: 'root',
      root: worktrees,
      git: git(),
    })
    writeFileSync(path.join(worktree.workingDir, 'pkg', 'a.ts'), 'export const a = 2\n')
    expect(await worktree.finish()).toEqual({ kept: true })
    expect(existsSync(worktree.dir)).toBe(true)
    const status = runSync('git', ['status', '--porcelain'], { cwd: root, env: scratchGitEnv() })
    expect(status.stdout.trim()).toBe('')
  })
})
