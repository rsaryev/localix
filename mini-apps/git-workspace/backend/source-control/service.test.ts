import { describe, expect, test } from 'bun:test'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { createSourceControlService } from './service'
import type { SourceControlBackend } from './ports'
import type { RepoBranch, RepoStatus, RepoWithStatus } from './contracts'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

const status = (root: string): RepoStatus => ({
  root,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  stats: { files: 0, insertions: 0, deletions: 0 },
  changeVersion: `${root}-v1`,
})

const branch = (name: string): RepoBranch => ({
  name,
  current: name === 'main',
  ahead: 0,
  behind: 0,
})

interface Spy {
  getStatus: number
  listBranches: number
  listRemoteBranches: number
  listStashes: number
}

/** A backend that counts what the service actually asks it for. */
function fakeBackend(overrides: Partial<SourceControlBackend> = {}) {
  const spy: Spy = { getStatus: 0, listBranches: 0, listRemoteBranches: 0, listStashes: 0 }
  const backend = {
    id: 'git',
    detect: async () => true,
    getStatus: async (cwd: string) => (spy.getStatus++, status(cwd)),
    listBranches: async () => (spy.listBranches++, [branch('main'), branch('feature')]),
    listRemoteBranches: async () => (spy.listRemoteBranches++, []),
    listStashes: async () => (spy.listStashes++, []),
    ...overrides,
  } as unknown as SourceControlBackend
  return { backend, spy }
}

function makeService(
  backend: SourceControlBackend,
  repos: RepoWithStatus[],
  cwd: string | null = '/repo/a',
) {
  return createSourceControlService({
    resolveCwd: async (_u, _s, repoRoot) => repoRoot ?? cwd,
    resolveBackend: async () => backend,
    listRepoStatuses: async () => repos,
  })
}

/** Let every pending promise chain (including timers) run to a standstill. */
const settle = () => turns()

const repoRow = (root: string, isPrimary = true): RepoWithStatus => ({
  root,
  name: root,
  isPrimary,
  status: { isRepo: true, vcs: 'git', ...status(root) },
})

describe('getWorkspace', () => {
  test('serves the panel in one call and does NOT re-read the status discovery already has', async () => {
    const { backend, spy } = fakeBackend()
    const service = makeService(backend, [repoRow('/repo/a')])

    const workspace = await service.getWorkspace('u', 's', '/repo/a')

    // The one thing this endpoint exists to stop: computing the focused repo's
    // status a second time, from a second snapshot of the same tree.
    expect(spy.getStatus).toBe(0)
    expect(workspace.status.changeVersion).toBe('/repo/a-v1')
    expect(workspace.activeRepo).toBe('/repo/a')
    expect(workspace.branches.current).toBe('main')
    expect(spy.listBranches).toBe(1)
    expect(spy.listStashes).toBe(1)
  })

  test('reads the status itself when discovery has no entry for the resolved repo', async () => {
    const { backend, spy } = fakeBackend()
    const service = makeService(backend, [])

    const workspace = await service.getWorkspace('u', 's')

    expect(spy.getStatus).toBe(1)
    expect(workspace.status.isRepo).toBe(true)
    expect(workspace.repos).toEqual([])
  })

  test('a focus that no longer exists falls back instead of blanking the panel', async () => {
    const { backend } = fakeBackend()
    // `/repo/gone` is not among the discovered repos, so the scoped resolve
    // fails closed — the panel must still get the session's own repo.
    const service = createSourceControlService({
      resolveCwd: async (_u, _s, repoRoot) =>
        repoRoot === undefined ? '/repo/a' : repoRoot === '/repo/a' ? '/repo/a' : null,
      resolveBackend: async () => backend,
      listRepoStatuses: async () => [repoRow('/repo/a')],
    })

    const workspace = await service.getWorkspace('u', 's', '/repo/gone')

    expect(workspace.status.isRepo).toBe(true)
    expect(workspace.activeRepo).toBe('/repo/a')
  })

  test('a repo-less session answers with the empty envelope, not a throw', async () => {
    const { backend } = fakeBackend()
    const service = createSourceControlService({
      resolveCwd: async () => null,
      resolveBackend: async () => backend,
      listRepoStatuses: async () => [],
    })

    const workspace = await service.getWorkspace('u', 's')
    expect(workspace.status.isRepo).toBe(false)
    expect(workspace.branches.isRepo).toBe(false)
    expect(workspace.activeRepo).toBeNull()
  })
})

// At startup the host may not have bound the session's directory yet. Answering that with a bare
// `isRepo: false` made the panel say "Not a git repository" and stop polling, so the verdict
// stuck until a remount. The two answers must be distinguishable.
describe('a directory that is not resolved yet is not "not a repo"', () => {
  const service = (cwd: string | null, isRepo: boolean) =>
    createSourceControlService({
      resolveCwd: async () => cwd,
      resolveBackend: async () => (isRepo ? fakeBackend().backend : null),
      listRepoStatuses: async () => [],
    })

  test('status and workspace mark an unresolved directory as unresolved', async () => {
    expect((await service(null, false).getStatus('u', 's')).unresolved).toBe(true)
    const workspace = await service(null, false).getWorkspace('u', 's')
    expect(workspace.status).toMatchObject({ isRepo: false, unresolved: true })
  })

  test('a resolved directory with no repository is a plain "not a repo"', async () => {
    const status = await service('/plain', false).getStatus('u', 's')
    expect(status.isRepo).toBe(false)
    expect(status.unresolved).toBeUndefined()
    const workspace = await service('/plain', false).getWorkspace('u', 's')
    expect(workspace.status.unresolved).toBeUndefined()
  })
})

describe('writes answer with what they invalidated', () => {
  test('a branch delete returns the branch list too — the UI needs no follow-up read', async () => {
    const { backend, spy } = fakeBackend({ deleteBranch: async () => undefined })
    const service = makeService(backend, [repoRow('/repo/a')])

    const result = await service.deleteBranch('u', 's', 'feature', false)

    expect(result.status.isRepo).toBe(true)
    expect(result.branches?.branches).toHaveLength(2)
    expect(spy.listBranches).toBe(1)
    // A branch delete cannot touch the stash stack, so it does not pay to read it.
    expect(spy.listStashes).toBe(0)
  })

  test('a working-tree write returns the status ALONE — nothing else moved', async () => {
    const { backend, spy } = fakeBackend({ stage: async () => undefined })
    const service = makeService(backend, [repoRow('/repo/a')])

    const result = await service.stage('u', 's', ['a.ts'])

    expect(result.status.isRepo).toBe(true)
    expect(result.branches).toBeUndefined()
    expect(spy.listBranches).toBe(0)
    expect(spy.listStashes).toBe(0)
  })

  test('a stash write returns the stack', async () => {
    const { backend, spy } = fakeBackend({ createStash: async () => undefined })
    const service = makeService(backend, [repoRow('/repo/a')])

    const result = await service.createStash('u', 's', { includeUntracked: true })

    expect(result.stashes).toEqual([])
    expect(spy.listStashes).toBe(1)
  })
})

describe('writes to one repository are serialized', () => {
  test('a second write waits for the first — git would just lose the index race', async () => {
    const order: string[] = []
    let releaseFirst: () => void = () => {
      throw new Error('first write was not blocked')
    }
    let started = 0
    const { backend } = fakeBackend({
      stage: async () => {
        const mine = ++started
        order.push(`start:${mine}`)
        if (mine === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        order.push(`end:${mine}`)
      },
    })
    const service = makeService(backend, [repoRow('/repo/a')])

    const first = service.stage('u', 's', ['a.ts'])
    // The write only reaches the queue after resolving the repo (two awaits of
    // its own), so settle the macrotask queue rather than counting microtasks.
    await settle()
    const second = service.stage('u', 's', ['b.ts'])
    await settle()

    expect(order).toEqual(['start:1'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2'])
  })

  test('a failed write still releases the queue', async () => {
    let attempt = 0
    const { backend } = fakeBackend({
      stage: async () => {
        attempt++
        if (attempt === 1) throw new ApiError(409, 'git_stage_failed', 'nope')
      },
    })
    const service = makeService(backend, [repoRow('/repo/a')])

    const first = service.stage('u', 's', ['a.ts'])
    const second = service.stage('u', 's', ['b.ts'])

    await expect(first).rejects.toBeInstanceOf(ApiError)
    await expect(second).resolves.toBeDefined()
  })

  test('different repositories still run in parallel', async () => {
    let inFlight = 0
    let peak = 0
    const { backend } = fakeBackend({
      stage: async () => {
        peak = Math.max(peak, ++inFlight)
        await turns()
        inFlight--
      },
    })
    const service = makeService(backend, [repoRow('/repo/a'), repoRow('/repo/b', false)])

    await Promise.all([
      service.stage('u', 's', ['a.ts'], '/repo/a'),
      service.stage('u', 's', ['b.ts'], '/repo/b'),
    ])

    expect(peak).toBe(2)
  })
})

describe('index-lock contention', () => {
  test('a write that lost the lock to another git is retried, not reported as a failure', async () => {
    let attempts = 0
    const { backend } = fakeBackend({
      stage: async () => {
        attempts++
        if (attempts < 3) {
          throw new ApiError(
            409,
            'git_stage_failed',
            "fatal: Unable to create '/repo/a/.git/index.lock': File exists.",
          )
        }
      },
    })
    const service = makeService(backend, [repoRow('/repo/a')])

    const result = await service.stage('u', 's', ['a.ts'])

    expect(attempts).toBe(3)
    expect(result.status.isRepo).toBe(true)
  })

  test('a genuine refusal is NOT retried — it is an answer, not a hiccup', async () => {
    let attempts = 0
    const { backend } = fakeBackend({
      stage: async () => {
        attempts++
        throw new ApiError(409, 'git_stage_failed', 'pathspec did not match any files')
      },
    })
    const service = makeService(backend, [repoRow('/repo/a')])

    await expect(service.stage('u', 's', ['a.ts'])).rejects.toBeInstanceOf(ApiError)
    expect(attempts).toBe(1)
  })

  test('a write that never wins the lock still gives up with the git message', async () => {
    const { backend } = fakeBackend({
      stage: async () => {
        throw new ApiError(409, 'git_stage_failed', 'Another git process seems to be running')
      },
    })
    const service = makeService(backend, [repoRow('/repo/a')])

    await expect(service.stage('u', 's', ['a.ts'])).rejects.toThrow(/Another git process/)
  })
})
