import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readRepoContext } from './repo-context'
import { gitRunner, runGit } from './cli'

describe('readRepoContext (real git repo)', () => {
  test('the git dir it reports is the one `--git-path` resolves against', async () => {
    // realpath: on macOS `/var` is a symlink to `/private/var`, and
    // `--absolute-git-dir` reports the resolved form.
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'repo-context-')))
    try {
      await runGit(dir, ['init', '-q'])
      // As every sibling suite does: a developer's global `commit.gpgsign` would otherwise route
      // this commit through their signing agent, which waits for a prompt until the test times out.
      await runGit(dir, ['config', 'commit.gpgsign', 'false'])
      await writeFile(join(dir, 'a.txt'), 'x\n')
      await runGit(dir, ['add', '.'])
      await runGit(dir, ['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-qm', 'first'])
      const run = gitRunner(dir)

      const context = await readRepoContext(run)
      expect(context.root).toBeTruthy()
      expect(context.head).toMatch(/^[0-9a-f]{40}$/)

      // The whole reason the join is safe: it agrees with git's own answer.
      // `--git-path` prints relative to cwd, so resolve it the way callers do.
      const viaGit = await run(['rev-parse', '--git-path', 'rebase-merge'])
      expect(resolve(dir, viaGit.stdout.trim())).toBe(join(context.gitDir!, 'rebase-merge'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
