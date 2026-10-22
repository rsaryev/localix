import { describe, expect, test } from 'bun:test'

import { createAgentWorktree, isWorkflowWorktreeDir, type GitRunner } from './worktree'

/**
 * An isolated workflow agent's worktree, with git faked: where it is made, where the agent works
 * in it, and that it is removed only when the agent changed nothing (Claude Code keeps it then).
 */
function fakeGit(answers: { top?: string; head?: string; status?: string; after?: string }) {
  const calls: string[] = []
  const git: GitRunner = async (cwd, args) => {
    calls.push(`${cwd}: ${args.join(' ')}`)
    const command = args.join(' ')
    if (command === 'rev-parse --show-toplevel') {
      if (!answers.top) throw new Error('not a repository')
      return answers.top
    }
    if (command === 'rev-parse --verify HEAD') return answers.head ?? ''
    if (command === 'rev-parse HEAD') return answers.after ?? answers.head ?? ''
    if (command === 'status --porcelain') return answers.status ?? ''
    return ''
  }
  return { git, calls }
}

const base = { cwd: '/repo/pkg', name: 'wf-000000000001-2', group: 'root-1', root: '/wt' }

describe('createAgentWorktree', () => {
  test('checks out HEAD on a branch of its own under the root; the agent works in the same subfolder', async () => {
    const { git, calls } = fakeGit({ top: '/repo', head: 'abc' })
    const worktree = await createAgentWorktree({ ...base, git })
    expect(worktree).toMatchObject({
      dir: '/wt/root-1/wf-000000000001-2',
      workingDir: '/wt/root-1/wf-000000000001-2/pkg',
      branch: 'localix/workflow/wf-000000000001-2',
    })
    expect(calls).toContain(
      '/repo: worktree add --quiet -b localix/workflow/wf-000000000001-2 /wt/root-1/wf-000000000001-2 abc',
    )
  })

  test('an unchanged worktree is removed with its branch; a changed one is kept', async () => {
    const clean = fakeGit({ top: '/repo', head: 'abc' })
    expect(await (await createAgentWorktree({ ...base, git: clean.git })).finish()).toEqual({
      kept: false,
    })
    expect(clean.calls).toContain('/repo: worktree remove --force /wt/root-1/wf-000000000001-2')
    expect(clean.calls).toContain('/repo: branch -D localix/workflow/wf-000000000001-2')

    for (const changed of [{ status: ' M a.ts' }, { after: 'def' }]) {
      const dirty = fakeGit({ top: '/repo', head: 'abc', ...changed })
      expect(await (await createAgentWorktree({ ...base, git: dirty.git })).finish()).toEqual({
        kept: true,
      })
      expect(dirty.calls.some((call) => call.includes('worktree remove'))).toBe(false)
    }
  })

  test('refuses a folder outside git, a repository with no commit, and a name that is a path', async () => {
    await expect(createAgentWorktree({ ...base, git: fakeGit({}).git })).rejects.toThrow(
      'git repository',
    )
    await expect(
      createAgentWorktree({ ...base, git: fakeGit({ top: '/repo' }).git }),
    ).rejects.toThrow('at least one commit')
    await expect(
      createAgentWorktree({ ...base, name: '../escape', git: fakeGit({ top: '/repo' }).git }),
    ).rejects.toThrow('plain folder name')
  })

  test('only a folder inside the worktree root is a worktree folder', () => {
    expect(isWorkflowWorktreeDir('/wt/root-1/wf-1', '/wt')).toBe(true)
    expect(isWorkflowWorktreeDir('/wt', '/wt')).toBe(false)
    expect(isWorkflowWorktreeDir('/wt/../etc', '/wt')).toBe(false)
    expect(isWorkflowWorktreeDir('relative/wf-1', '/wt')).toBe(false)
  })
})
