import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { run, scratchGitEnv, tempDirPerTest } from '@localixai/testing'

import { parseRemote, readStatusLineWorkspace } from './status-line-workspace'

/** `workspace.repo` and `workspace.git_worktree` of a status line, read from the folder's git. */
const scratch = tempDirPerTest('status-line-workspace-')
const env = scratchGitEnv()
const git = (cwd: string, ...args: string[]) => run('git', ['-C', cwd, ...args], { env })

describe('the repository a remote names', () => {
  test.each([
    ['git@github.com:anthropics/claude-code.git', 'github.com', 'anthropics', 'claude-code'],
    ['https://github.com/anthropics/claude-code', 'github.com', 'anthropics', 'claude-code'],
    ['ssh://git@gitlab.com/group/sub/project.git', 'gitlab.com', 'group/sub', 'project'],
  ])('%s', (url, host, owner, name) => {
    expect(parseRemote(url)).toEqual({ host, owner, name })
  })

  test('a path that names no owner names no repository', () => {
    expect(parseRemote('/srv/git/project.git')).toBeUndefined()
    expect(parseRemote('not a url')).toBeUndefined()
  })
})

describe('the checkout of a folder', () => {
  test('a repository with an origin, and the linked worktree of it', async () => {
    const main = join(scratch(), 'main')
    await git(scratch(), 'init', '-q', main)
    await git(main, 'remote', 'add', 'origin', 'git@github.com:rsaryev/localix.git')
    await git(main, 'commit', '--allow-empty', '-q', '-m', 'init')
    expect(await readStatusLineWorkspace(main)).toEqual({
      repo: { host: 'github.com', owner: 'rsaryev', name: 'localix' },
    })

    const linked = join(scratch(), 'feature-x')
    await git(main, 'worktree', 'add', '-q', linked)
    expect(await readStatusLineWorkspace(linked)).toEqual({
      repo: { host: 'github.com', owner: 'rsaryev', name: 'localix' },
      worktree: 'feature-x',
    })
  })

  test('a folder outside any repository has neither', async () => {
    expect(await readStatusLineWorkspace(scratch())).toEqual({})
  })
})
