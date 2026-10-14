import { describe, expect, mock, test } from 'bun:test'
import type { SourceControlStatus } from '../../../../backend/source-control/contracts'
import { historyWrites } from '../../../api/history-writes'
import { refWrites } from '../../../api/ref-writes'
import { treeWrites } from '../../../api/tree-writes'
import { createSourceControlStore } from '../store'
import { MUTATIONS, type SourceControlApi } from './mutations'

const status: SourceControlStatus = {
  isRepo: true,
  vcs: 'git',
  root: '/workspace/a',
  branch: 'main',
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  stats: { files: 0, insertions: 0, deletions: 0 },
  changeVersion: 'v1',
}

/** The stash stack is a ref family write that the commit graph does not draw. */
const STASH_WRITES = new Set(['createStash', 'applyStash', 'dropStash'])

describe('which writes tell the commit graph to re-read', () => {
  test('a commit bumps logVersion, so the graph shows the new tip', async () => {
    const api = {
      commit: mock(async () => ({ status })),
    } as unknown as SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().commit('s1', 'feat: x')

    expect(store.getState().logVersion).toBe(1)
  })

  test('staging leaves logVersion alone — no ref moved', async () => {
    const api = { stage: mock(async () => ({ status })) } as unknown as SourceControlApi
    const store = createSourceControlStore(api)

    await store.getState().stage('s1', ['a.ts'])

    expect(store.getState().logVersion).toBe(0)
  })

  test('every history write bumps the log', () => {
    for (const name of Object.keys(historyWrites)) {
      const spec = MUTATIONS[name as keyof typeof MUTATIONS]
      if (spec) expect({ name, bumpsLog: spec.bumpsLog }).toEqual({ name, bumpsLog: true })
    }
  })

  test('every ref write bumps the log, except the stash stack', () => {
    for (const name of Object.keys(refWrites)) {
      const spec = MUTATIONS[name as keyof typeof MUTATIONS]
      if (!spec) continue
      expect({ name, bumpsLog: spec.bumpsLog }).toEqual({ name, bumpsLog: !STASH_WRITES.has(name) })
    }
  })

  test('no working-tree write bumps the log', () => {
    for (const name of Object.keys(treeWrites)) {
      const spec = MUTATIONS[name as keyof typeof MUTATIONS]
      if (spec) expect({ name, bumpsLog: spec.bumpsLog }).toEqual({ name, bumpsLog: false })
    }
  })

  test('the bump lands in the same store write as the status', async () => {
    const api = {
      switchBranch: mock(async () => ({ status: { ...status, branch: 'feature' } })),
    } as unknown as SourceControlApi
    const store = createSourceControlStore(api)
    const writes: number[] = []
    store.subscribe((s) => writes.push(s.logVersion))

    await store.getState().switchBranch('s1', 'feature')

    // One notification carrying both — the graph never renders the new branch with the old log.
    expect(writes).toEqual([1])
    expect(store.getState().bySession.s1?.status?.branch).toBe('feature')
  })

  test('the focused repo is passed to the API when the caller names none', async () => {
    const commit = mock(async () => ({ status }))
    const store = createSourceControlStore({ commit } as unknown as SourceControlApi)
    store.setState({
      bySession: {
        s1: {
          status,
          branches: null,
          stashes: [],
          repos: [],
          activeRepo: '/workspace/a',
          loading: false,
          error: null,
        },
      },
    })

    await store.getState().commit('s1', 'msg')

    expect(commit.mock.calls[0] as unknown[]).toEqual(['s1', 'msg', '/workspace/a'])
  })
})
