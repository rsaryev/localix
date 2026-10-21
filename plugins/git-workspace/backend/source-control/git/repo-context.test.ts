import { describe, expect, test } from 'bun:test'
import { REPO_CONTEXT_ARGS, parseRepoContext, readRepoContext } from './repo-context'
import type { GitResult, GitRunner } from './cli'

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
