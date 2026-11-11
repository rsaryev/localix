import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { runSync, scratchGitEnv, tempDirPerTest, writeTree } from '@localixai/testing'

import { fetchGitTree } from './git-fetch'

/**
 * The real fetchers behind Claude Code plugin sources: `git` over a local repository (a pinned
 * commit, a sparse `git-subdir` checkout). An archive is `marketplace-archive-install.test.ts`.
 */

const dir = tempDirPerTest('cc-fetch')

function git(cwd: string, ...args: string[]): string {
  const result = runSync('git', args, { cwd, env: scratchGitEnv() })
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

describe('fetchGitTree', () => {
  it('checks out a pinned commit after the branch moved on, and a sparse subdirectory', async () => {
    const repo = join(dir(), 'repo')
    writeTree(repo, { 'tools/mono/a.txt': 'v1', 'other/b.txt': 'b' })
    git(repo, 'init', '--quiet', '--initial-branch=main')
    git(repo, 'add', '.')
    git(repo, 'commit', '--quiet', '-m', 'one')
    const pinned = git(repo, 'rev-parse', 'HEAD')
    writeTree(repo, { 'tools/mono/a.txt': 'v2' })
    git(repo, 'commit', '--quiet', '-am', 'two')
    const url = `file://${repo}`

    const at = join(dir(), 'pinned')
    await fetchGitTree(url, at, { ref: pinned, sparse: 'tools/mono' })
    expect(await fs.readFile(join(at, 'tools/mono/a.txt'), 'utf8')).toBe('v1')
    expect(await fs.stat(join(at, 'other')).catch(() => null)).toBeNull()

    const head = join(dir(), 'head')
    await fetchGitTree(url, head, { ref: 'main' })
    expect(await fs.readFile(join(head, 'tools/mono/a.txt'), 'utf8')).toBe('v2')

    // An abbreviated commit cannot be fetched by name; the full fetch finds it.
    const short = join(dir(), 'short')
    await fetchGitTree(url, short, { ref: pinned.slice(0, 10) })
    expect(await fs.readFile(join(short, 'tools/mono/a.txt'), 'utf8')).toBe('v1')
  })
})
