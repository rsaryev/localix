import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import {
  abortMerge,
  checkoutRemoteBranch,
  createBranch,
  deleteBranch,
  listBranches,
  listRemoteBranches,
  mergeBranch,
  renameBranch,
} from './branches'
import { gitRunner, type GitResult, type GitRunner } from './cli'

const ok = (stdout = ''): GitResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stderr: string): GitResult => ({ ok: false, stdout: '', stderr, code: 1 })

/** A GitRunner that records the args it was called with and replays a queued result. */
function fakeRunner(result: GitResult): { run: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  return { run: async (args) => (calls.push(args), result), calls }
}

describe('createBranch + renameBranch + deleteBranch (real git)', () => {
  let dir: string
  let run: GitRunner

  const current = async () => (await listBranches(run)).find((b) => b.current)?.name

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-branches-'))
    run = gitRunner(dir)
    await run(['init', '-q'])
    await run(['config', 'user.email', 't@t.t'])
    await run(['config', 'user.name', 't'])
    await run(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(dir, 'f.txt'), 'x\n', 'utf8')
    await run(['add', 'f.txt'])
    await run(['commit', '-qm', 'init'])
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('creates a branch and switches onto it', async () => {
    await createBranch(run, 'feature/login')
    expect(await current()).toBe('feature/login')
    const list = await listBranches(run)
    expect(list.map((b) => b.name).sort()).toContain('feature/login')
    // No upstream → ahead/behind default to 0 (populated on the wire, not undefined).
    const b = list.find((x) => x.name === 'feature/login')
    expect(b).toMatchObject({ ahead: 0, behind: 0 })
  })

  test('refuses to create a branch that already exists', async () => {
    await createBranch(run, 'dup')
    // back to a branch we can create dup off again
    await run(['checkout', '-q', '-'])
    let caught: unknown
    try {
      await createBranch(run, 'dup')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })

  test('renames the current branch, keeping it current', async () => {
    await createBranch(run, 'wip')
    await renameBranch(run, 'wip', 'ready')
    expect(await current()).toBe('ready')
    const names = (await listBranches(run)).map((b) => b.name)
    expect(names).toContain('ready')
    expect(names).not.toContain('wip')
  })

  test('renames a non-current branch', async () => {
    await createBranch(run, 'other')
    await run(['checkout', '-q', '-']) // leave "other"
    const before = await current()
    await renameBranch(run, 'other', 'other-renamed')
    expect(await current()).toBe(before) // untouched
    const names = (await listBranches(run)).map((b) => b.name)
    expect(names).toContain('other-renamed')
    expect(names).not.toContain('other')
  })

  test('refuses an invalid branch name', async () => {
    let caught: unknown
    try {
      await createBranch(run, 'bad..name')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })

  test('deletes a merged branch (safe -d)', async () => {
    await createBranch(run, 'merged') // no new commits → fully merged with base
    await run(['checkout', '-q', '-'])
    await deleteBranch(run, 'merged', false)
    expect((await listBranches(run)).map((b) => b.name)).not.toContain('merged')
  })

  test('refuses -d on an unmerged branch, but -D force succeeds', async () => {
    await createBranch(run, 'wip')
    await writeFile(join(dir, 'g.txt'), 'y\n', 'utf8')
    await run(['add', 'g.txt'])
    await run(['commit', '-qm', 'wip commit']) // commit only on wip → not merged
    await run(['checkout', '-q', '-'])
    let caught: unknown
    try {
      await deleteBranch(run, 'wip', false)
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_branch_not_merged')
    // force drops it
    await deleteBranch(run, 'wip', true)
    expect((await listBranches(run)).map((b) => b.name)).not.toContain('wip')
  })

  test('refuses to delete the current branch', async () => {
    await createBranch(run, 'here')
    let caught: unknown
    try {
      await deleteBranch(run, 'here', true)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(409)
  })
})

describe('listRemoteBranches', () => {
  const raw = [
    'origin/HEAD\t2 days ago',
    'origin/main\t2 days ago',
    'origin/feature/login\t3 hours ago',
    'upstream/main\t1 week ago',
    '',
  ].join('\n')

  test('drops the origin/HEAD symref — a pointer, not a branch', async () => {
    const { run, calls } = fakeRunner(ok(raw))
    const remotes = await listRemoteBranches(run)

    expect(calls[0]).toEqual([
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname:short)%09%(committerdate:relative)',
      'refs/remotes',
    ])
    // Everything else survives: excluding the ones that already exist LOCALLY is
    // the service's join, so this call never has to wait for the local list.
    expect(remotes.map((r) => r.name)).toEqual([
      'origin/main',
      'origin/feature/login',
      'upstream/main',
    ])
  })

  test('splits the remote off the branch name, keeping slashes in the branch', async () => {
    const { run } = fakeRunner(ok('origin/feature/login\t3 hours ago\n'))
    const [entry] = await listRemoteBranches(run)
    expect(entry).toEqual({
      name: 'origin/feature/login',
      remote: 'origin',
      shortName: 'feature/login',
      updatedAt: '3 hours ago',
    })
  })

  test('a repo with no remote is empty, not an error', async () => {
    const { run } = fakeRunner(fail('fatal: not a git repository'))
    expect(await listRemoteBranches(run)).toEqual([])
  })
})

describe('checkoutRemoteBranch', () => {
  test('creates the local tracking branch in one step', async () => {
    const { run, calls } = fakeRunner(ok())
    await checkoutRemoteBranch(run, 'origin/feature/login')
    expect(calls[0]).toEqual(['switch', '--track', 'origin/feature/login'])
  })

  test("surfaces git's refusal as a 409", async () => {
    const { run } = fakeRunner(fail("fatal: a branch named 'feature/login' already exists\n"))
    await expect(checkoutRemoteBranch(run, 'origin/feature/login')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('mergeBranch', () => {
  test('runs a non-interactive merge, fast-forwarding by default', async () => {
    const { run, calls } = fakeRunner(ok())
    await mergeBranch(run, 'feature/x')
    expect(calls[0]).toEqual(['merge', '--no-edit', 'feature/x'])
  })

  test('noFastForward always records a merge commit', async () => {
    const { run, calls } = fakeRunner(ok())
    await mergeBranch(run, 'feature/x', { noFastForward: true })
    expect(calls[0]).toEqual(['merge', '--no-edit', '--no-ff', 'feature/x'])
  })

  test('a conflicted stop gets its OWN code — the merge is in progress, not failed', async () => {
    const run: GitRunner = async () => ({
      ok: false,
      stdout: 'CONFLICT (content): Merge conflict in a.ts\nAutomatic merge failed\n',
      stderr: '',
      code: 1,
    })
    let caught: unknown
    try {
      await mergeBranch(run, 'feature/x')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_merge_conflict')
  })

  test('a refusal that changed nothing stays a plain failure', async () => {
    const { run } = fakeRunner(fail('error: Your local changes would be overwritten\n'))
    let caught: unknown
    try {
      await mergeBranch(run, 'feature/x')
    } catch (err) {
      caught = err
    }
    expect((caught as ApiError).code).toBe('git_merge_failed')
  })
})

describe('abortMerge', () => {
  test('runs `git merge --abort`', async () => {
    const { run, calls } = fakeRunner(ok())
    await abortMerge(run)
    expect(calls[0]).toEqual(['merge', '--abort'])
  })
})
