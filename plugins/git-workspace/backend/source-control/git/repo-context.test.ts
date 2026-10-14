import { describe, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { REPO_CONTEXT_ARGS, parseRepoContext, readRepoContext } from './repo-context'
import { gitRunner, runGit, type GitResult, type GitRunner } from './cli'

const SHA = 'a'.repeat(40)

describe('parseRepoContext', () => {
  test('reads root, git dir and HEAD from the three positional lines', () => {
    expect(parseRepoContext(`/repo\n/repo/.git\n${SHA}\n`)).toEqual({
      root: '/repo',
      gitDir: '/repo/.git',
      head: SHA,
    })
  })

  test('an unborn branch prints two lines — the paths survive, HEAD is null', () => {
    expect(parseRepoContext('/repo\n/repo/.git\n')).toEqual({
      root: '/repo',
      gitDir: '/repo/.git',
      head: null,
    })
  })

  test('a third line that is not a sha is not mistaken for one', () => {
    expect(parseRepoContext('/repo\n/repo/.git\nfatal: bad revision\n').head).toBeNull()
  })

  test('empty output degrades to all-null rather than throwing', () => {
    expect(parseRepoContext('')).toEqual({ root: null, gitDir: null, head: null })
  })
})

describe('readRepoContext (one invocation)', () => {
  test('asks git exactly once', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      return { ok: true, stdout: `/repo\n/repo/.git\n${SHA}\n`, stderr: '', code: 0 } as GitResult
    }
    const context = await readRepoContext(run)
    expect(calls).toEqual([REPO_CONTEXT_ARGS])
    expect(context.head).toBe(SHA)
  })

  test('a non-zero exit still yields whatever git printed (the unborn-HEAD case)', async () => {
    const run: GitRunner = async () =>
      ({ ok: false, stdout: '/repo\n/repo/.git\n', stderr: '', code: 1 }) as GitResult
    expect(await readRepoContext(run)).toEqual({
      root: '/repo',
      gitDir: '/repo/.git',
      head: null,
    })
  })
})

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
