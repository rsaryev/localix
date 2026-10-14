import { describe, expect, mock, test } from 'bun:test'
import type {
  RepoWithStatus,
  SourceControlBranches,
  SourceControlStatus,
  SourceControlWorkspace,
} from '../../../backend/source-control/contracts'
import { createSourceControlStore, sourceControlFileStamp } from './store'
import type { sourceControlApi as SourceControlApi } from '../../api'

/**
 * Spin until `condition()` holds, yielding only to the MICROTASK queue.
 *
 * Bounded on purpose. `while (!x) await Promise.resolve()` drains microtasks and never yields to
 * the macrotask queue, so bun's `--timeout` cannot interrupt it: a condition that stops becoming
 * true wedges the entire RUN — one banner line, no file name, no failing test to point at. The
 * bound turns that into a named failure.
 */
async function spinUntil(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 100_000; turn++) {
    if (condition()) return
    await Promise.resolve()
  }
  throw new Error(`Timed out waiting for ${what} (100k microtask turns)`)
}

const status = (root: string, file: string): SourceControlStatus => ({
  isRepo: true,
  vcs: 'git',
  root,
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [
    {
      path: file,
      status: 'modified',
      staged: false,
      unstaged: true,
      insertions: 1,
      deletions: 0,
    },
  ],
  stats: { files: 1, insertions: 1, deletions: 0 },
  changeVersion: `${root}-v1`,
})

const branches = (root: string): SourceControlBranches => ({
  isRepo: true,
  vcs: 'git',
  current: 'main',
  branches: [{ name: `main-${root}`, current: true, ahead: 0, behind: 0 }],
  remotes: [],
})

const repo = (root: string, value: SourceControlStatus, isPrimary = false): RepoWithStatus => ({
  root,
  name: root.split('/').pop() ?? root,
  isPrimary,
  status: value,
})

/** The workspace envelope the panel polls — repos plus the focused repo's detail. */
const workspace = (
  repos: RepoWithStatus[],
  activeRepo: string | null,
  value: SourceControlStatus,
): SourceControlWorkspace => ({
  repos,
  activeRepo,
  status: value,
  branches: branches(activeRepo ?? ''),
  stashes: [],
})

describe('source-control workspace refresh', () => {
  test('a failed workspace read is surfaced instead of becoming an empty-repository state', async () => {
    const getWorkspace = mock(async () => {
      throw new Error('workspace identity unavailable')
    })
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')

    const state = store.getState().bySession.s1
    expect(state?.repos).toEqual([])
    expect(state?.status).toBeNull()
    expect(state?.error).toContain('workspace identity unavailable')
  })

  test('the whole panel state arrives in ONE request per poll', async () => {
    const a = status('/workspace/a', 'a.ts')
    const getWorkspace = mock(async () =>
      workspace([repo('/workspace/a', a, true)], '/workspace/a', a),
    )
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')

    expect(getWorkspace).toHaveBeenCalledTimes(1)
    const state = store.getState().bySession.s1
    expect(state?.status?.root).toBe('/workspace/a')
    expect(state?.branches?.current).toBe('main')
    expect(state?.repos).toHaveLength(1)
  })

  test('an unchanged poll leaves the cached slice identical, so nothing re-renders', async () => {
    const a = status('/workspace/a', 'a.ts')
    const api = {
      // A fresh (deep-equal, non-identical) payload every tick, as the wire gives.
      getWorkspace: mock(async () =>
        workspace([repo('/workspace/a', structuredClone(a), true)], '/workspace/a', {
          ...structuredClone(a),
        }),
      ),
    } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    const first = store.getState().bySession.s1
    await store.getState().refresh('s1')

    expect(store.getState().bySession.s1).toBe(first!)
  })

  test('a commit-context refresh always reads once after an older poll settles', async () => {
    const first = status('/workspace/a', 'before.ts')
    const second = { ...status('/workspace/a', 'after.ts'), changeVersion: '/workspace/a-v2' }
    let calls = 0
    const getWorkspace = mock(async () => {
      calls++
      if (calls === 1) {
        return new Promise<SourceControlWorkspace>((resolve) => {
          releaseFirst = () =>
            resolve(workspace([repo('/workspace/a', first, true)], '/workspace/a', first))
        })
      }
      return workspace([repo('/workspace/a', second, true)], '/workspace/a', second)
    })
    let releaseFirst: () => void = () => {
      throw new Error('First workspace read was not blocked')
    }
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    const oldPoll = store.getState().refresh('s1')
    await spinUntil(() => calls > 0, 'the first workspace read to start')
    const contextRefresh = store.getState().refreshFresh('s1')
    releaseFirst()
    await Promise.all([oldPoll, contextRefresh])

    expect(calls).toBe(2)
    expect(store.getState().bySession.s1?.status?.changeVersion).toBe('/workspace/a-v2')
    expect(store.getState().bySession.s1?.status?.files[0]?.path).toBe('after.ts')
  })

  test('a slow old-repo poll cannot overwrite a newly focused repo', async () => {
    const a = status('/workspace/a', 'a.ts')
    const b = status('/workspace/b', 'b.ts')
    const repos = [repo('/workspace/a', a, true), repo('/workspace/b', b)]

    let blockNextA = false
    let aRequestBlocked = false
    let releaseA: () => void = () => {
      throw new Error('A request was not blocked')
    }
    const getWorkspace = mock(async (_sessionId: string, root?: string) => {
      if (root !== '/workspace/b' && blockNextA) {
        blockNextA = false
        return new Promise<SourceControlWorkspace>((resolve) => {
          aRequestBlocked = true
          releaseA = () => resolve(workspace(repos, '/workspace/a', a))
        })
      }
      return root === '/workspace/b'
        ? workspace(repos, '/workspace/b', b)
        : workspace(repos, '/workspace/a', a)
    })
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/a')

    blockNextA = true
    const oldPoll = store.getState().refresh('s1')
    await spinUntil(() => aRequestBlocked, "repo A's read to block")

    const switchToB = store.getState().setActiveRepo('s1', '/workspace/b')
    // Focus and file inventory switch atomically from the list snapshot, before
    // either network request finishes.
    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.status?.files[0]?.path).toBe('b.ts')

    releaseA()
    await Promise.all([oldPoll, switchToB])

    const final = store.getState().bySession.s1
    expect(final?.activeRepo).toBe('/workspace/b')
    expect(final?.status?.root).toBe('/workspace/b')
    expect(getWorkspace.mock.calls.at(-1)?.[1]).toBe('/workspace/b')
  })

  test("switching repositories does not wait out the previous repo's poll", async () => {
    const a = status('/workspace/a', 'a.ts')
    const b = status('/workspace/b', 'b.ts')
    const repos = [repo('/workspace/a', a, true), repo('/workspace/b', b)]
    let releaseA: () => void = () => {
      throw new Error("repo A's poll was not blocked")
    }
    let aBlocked = false
    let blockA = false
    const getWorkspace = mock(async (_sessionId: string, root?: string) => {
      if (root !== '/workspace/b' && blockA) {
        blockA = false
        return new Promise<SourceControlWorkspace>((resolve) => {
          aBlocked = true
          releaseA = () => resolve(workspace(repos, '/workspace/a', a))
        })
      }
      return root === '/workspace/b'
        ? workspace(repos, '/workspace/b', b)
        : workspace(repos, '/workspace/a', a)
    })
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    blockA = true
    const stuckPoll = store.getState().refresh('s1')
    await spinUntil(() => aBlocked, "repo A's poll to block")

    // The switch completes while A's poll is STILL outstanding. Keyed on the
    // session alone, this read would have joined (and been discarded) or waited.
    await store.getState().setActiveRepo('s1', '/workspace/b')
    expect(store.getState().bySession.s1?.status?.root).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.branches).not.toBeNull()

    releaseA()
    await stuckPoll
    // The late poll spoke for the repo we left; it must not win.
    expect(store.getState().bySession.s1?.status?.root).toBe('/workspace/b')
  })

  test('falls back to a remaining repository when the active repository disappears', async () => {
    const a = status('/workspace/a', 'a.ts')
    const b = status('/workspace/b', 'b.ts')
    let discovery = 0
    const api = {
      getWorkspace: mock(async () => {
        discovery++
        return discovery === 1
          ? workspace([repo('/workspace/a', a, true), repo('/workspace/b', b)], '/workspace/a', a)
          : workspace([repo('/workspace/b', b, true)], '/workspace/b', b)
      }),
    } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/a')

    await store.getState().refresh('s1')

    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.status?.root).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.status?.files[0]?.path).toBe('b.ts')
  })

  test('a transient discovery failure preserves the selected repository scope', async () => {
    const a = status('/workspace/a', 'a.ts')
    const b = status('/workspace/b', 'b.ts')
    const repos = [repo('/workspace/a', a, true), repo('/workspace/b', b)]
    let discovery = 0
    const getWorkspace = mock(async (_sessionId: string, root?: string) => {
      discovery++
      // After the first pass the filesystem scan comes back empty, but the scoped
      // detail still resolves — the server's own fallback.
      const found = discovery > 1 ? [] : repos
      return workspace(found, root ?? '/workspace/a', root === '/workspace/b' ? b : a)
    })
    const api = { getWorkspace } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    await store.getState().setActiveRepo('s1', '/workspace/b')
    await store.getState().refresh('s1')

    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.status?.root).toBe('/workspace/b')
    expect(store.getState().bySession.s1?.repos).toHaveLength(2)
    expect(getWorkspace.mock.calls.at(-1)?.[1]).toBe('/workspace/b')
  })

  test('a resolved non-repository clears old discovery and allows the next automatic probe to recover', async () => {
    const value = status('/workspace/a', 'a.ts')
    const absent = { ...value, isRepo: false, root: null, branch: null, files: [] }
    const getWorkspace = mock(async () =>
      workspace([repo('/workspace/a', value)], '/workspace/a', value),
    )
    const store = createSourceControlStore({ getWorkspace } as unknown as typeof SourceControlApi)
    await store.getState().refresh('s1')
    getWorkspace.mockImplementation(async () => workspace([], null, absent))
    await store.getState().refresh('s1')
    expect(store.getState().bySession.s1?.activeRepo).toBeNull()
    expect(store.getState().bySession.s1?.repos).toEqual([])
    expect(store.getState().bySession.s1?.status?.isRepo).toBe(false)
    getWorkspace.mockImplementation(async () =>
      workspace([repo('/workspace/a', value)], '/workspace/a', value),
    )
    await store.getState().refresh('s1')
    expect(store.getState().bySession.s1?.status?.isRepo).toBe(true)
    expect(store.getState().bySession.s1?.activeRepo).toBe('/workspace/a')
  })
})

describe('source-control writes answer for themselves', () => {
  test('a write repaints from its OWN response — no follow-up read', async () => {
    const before = status('/workspace/a', 'before.ts')
    const after = { ...status('/workspace/a', 'after.ts'), changeVersion: '/workspace/a-v2' }
    const getWorkspace = mock(async () =>
      workspace([repo('/workspace/a', before, true)], '/workspace/a', before),
    )
    const api = {
      getWorkspace,
      stage: mock(async () => ({ status: after })),
    } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    expect(getWorkspace).toHaveBeenCalledTimes(1)

    await store.getState().stage('s1', ['after.ts'])

    // The write's own answer is the new truth; nothing re-polls behind it.
    expect(getWorkspace).toHaveBeenCalledTimes(1)
    expect(store.getState().bySession.s1?.status?.changeVersion).toBe('/workspace/a-v2')
    // …and the repo inventory row was patched with it, so the grouped tree agrees.
    expect(store.getState().bySession.s1?.repos[0]?.status.changeVersion).toBe('/workspace/a-v2')
  })

  test('a write is not blocked behind an in-flight poll', async () => {
    const a = status('/workspace/a', 'a.ts')
    const deleted = { ...a, changeVersion: '/workspace/a-v2' }
    let releasePoll: () => void = () => {
      throw new Error('poll was not blocked')
    }
    let pollStarted = false
    const api = {
      getWorkspace: mock(
        async () =>
          new Promise<SourceControlWorkspace>((resolve) => {
            pollStarted = true
            releasePoll = () =>
              resolve(workspace([repo('/workspace/a', a, true)], '/workspace/a', a))
          }),
      ),
      deleteBranch: mock(async () => ({
        status: deleted,
        branches: { ...branches('/workspace/a'), branches: [] },
      })),
    } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    const poll = store.getState().refresh('s1')
    await spinUntil(() => pollStarted, 'the poll to start')

    // Completes while the poll is still outstanding — the whole point.
    await store.getState().deleteBranch('s1', 'feature', false)
    expect(store.getState().bySession.s1?.branches?.branches).toEqual([])
    expect(store.getState().bySession.s1?.status?.changeVersion).toBe('/workspace/a-v2')

    releasePoll()
    await poll
  })

  test('a write targeting an unfocused repository never replaces the focused status', async () => {
    const a = status('/workspace/a', 'a.ts')
    const b = status('/workspace/b', 'b.ts')
    const changedB = { ...status('/workspace/b', 'changed-b.ts'), changeVersion: '/workspace/b-v2' }
    const api = {
      getWorkspace: mock(async () =>
        workspace([repo('/workspace/a', a, true), repo('/workspace/b', b)], '/workspace/a', a),
      ),
      stage: mock(async () => ({ status: changedB })),
    } as unknown as typeof SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().refresh('s1')
    await store.getState().stage('s1', ['changed-b.ts'], '/workspace/b')

    expect(store.getState().bySession.s1?.status?.root).toBe('/workspace/a')
    expect(store.getState().bySession.s1?.status?.files[0]?.path).toBe('a.ts')
    // The unfocused repo's own row still learns about it.
    expect(
      store.getState().bySession.s1?.repos.find((r) => r.root === '/workspace/b')?.status
        .changeVersion,
    ).toBe('/workspace/b-v2')
  })
})

describe('source-control diff ownership', () => {
  test('uses the requested repository instead of an unrelated active repository', () => {
    const a = status('/workspace/a', 'same.ts')
    const b = {
      ...status('/workspace/b', 'same.ts'),
      changeVersion: '/workspace/b-v2',
    }
    const state = {
      status: a,
      branches: null,
      stashes: [],
      repos: [repo('/workspace/a', a, true), repo('/workspace/b', b)],
      activeRepo: '/workspace/a',
      loading: false,
      error: null,
    }

    expect(sourceControlFileStamp(state, 'same.ts', '/workspace/b')).toStartWith('/workspace/b-v2|')
  })

  test('changes when content changes without changing staged flags or line totals', () => {
    const before = status('/workspace/a', 'same.ts')
    const after = { ...before, changeVersion: '/workspace/a-v2' }
    const slice = (value: SourceControlStatus) => ({
      status: value,
      branches: null,
      stashes: [],
      repos: [repo('/workspace/a', value, true)],
      activeRepo: '/workspace/a',
      loading: false,
      error: null,
    })

    expect(sourceControlFileStamp(slice(before), 'same.ts')).not.toBe(
      sourceControlFileStamp(slice(after), 'same.ts'),
    )
  })
})
