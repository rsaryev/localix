import { describe, expect, test } from 'bun:test'

import { createActiveRuns } from './active-runs'
import { createRuntimeState } from './agent-runner-state'
import { testWork } from '../../../testing/work-fixture'
import { requireRunSettlement, stopSession, waitForRunSettlement } from './stop-session'

describe('waitForRunSettlement', () => {
  test('wakes on the registry releasing the exact run, not on a timer', async () => {
    const run = new AbortController()
    const activeRuns = createActiveRuns()
    activeRuns.set('s1', run)
    let settled = false
    // A bound no test would survive: only the release announcement can settle this in time.
    const wait = waitForRunSettlement(activeRuns, 's1', run, 600_000).then((value) => {
      settled = value
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    activeRuns.delete('s1')
    // Settled within the same turn of the event loop: no re-check timer stands in between.
    await Promise.resolve()
    expect(settled).toBe(true)
    await wait
  })

  test('does not wait on a continuation that replaced the stopped run', async () => {
    const oldRun = new AbortController()
    const activeRuns = new Map([['s1', new AbortController()]])
    expect(await waitForRunSettlement(activeRuns, 's1', oldRun, 0)).toBe(true)
  })

  test('times out instead of hanging the stop control plane', async () => {
    const run = new AbortController()
    const activeRuns = new Map([['s1', run]])
    expect(await waitForRunSettlement(activeRuns, 's1', run, 0)).toBe(false)
  })

  test('does not acknowledge a stop while the run still owns its registry slot', async () => {
    const run = new AbortController()
    const activeRuns = new Map([['s1', run]])
    await Promise.resolve(
      expect(requireRunSettlement(activeRuns, 's1', run, 0)).rejects.toThrow(
        'Stop timed out while s1 was still shutting down',
      ),
    )
  })
})

describe('stopSession acknowledgement', () => {
  test('waits for a non-chat status write before reporting the run stopped', async () => {
    const state = createRuntimeState(testWork())
    const abort = new AbortController()
    state.activeRuns.set('child-1', abort)
    state.activeRunSessions.set('child-1', {
      userId: 'user-1',
      session: { id: 'child-1', sessionKind: 'subagent' } as never,
    })
    let resolveStatus!: (value: unknown) => void
    const statusWritten = new Promise((resolve) => {
      resolveStatus = resolve
    })
    let settled = false
    const stopping = stopSession(
      {
        state,
        repo: {} as never,
        streamRegistry: {} as never,
        now: () => 'now',
        markRuntimeSessionStatus: () => statusWritten as never,
      },
      'child-1',
    ).then((value) => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(abort.signal.aborted).toBe(true)
    state.activeRuns.delete('child-1')
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveStatus({})
    await Promise.resolve(expect(stopping).resolves.toBe(true))
  })
})

describe('an operator stop reaches the sessions this one spawned', () => {
  /**
   * A spawned child runs detached — its own run, its own id, no signal from the parent.
   * Right for an ordinary turn, wrong for a Stop: the person who would have read the
   * child's report just asked for the work to end.
   */
  const harness = (children: Record<string, string[]>) => {
    const state = createRuntimeState(testWork())
    const stopped: string[] = []
    for (const id of ['parent', ...Object.values(children).flat()]) {
      const abort = new AbortController()
      abort.signal.addEventListener('abort', () => stopped.push(id))
      state.activeRuns.set(id, abort)
      state.activeRunSessions.set(id, {
        userId: 'u1',
        session: { id, sessionKind: id === 'parent' ? 'chat' : 'subagent' } as never,
      })
    }
    const ctx = {
      state,
      repo: {
        listChildSessionIds: async (_u: string, parentId: string) => children[parentId] ?? [],
      } as never,
      streamRegistry: { publish: () => {} } as never,
      now: () => 'now',
      markRuntimeSessionStatus: async (_u: string, session: unknown) => session as never,
    }
    return { ctx, state, stopped }
  }

  test('stops a child, and a child of a child', async () => {
    const { ctx, state, stopped } = harness({ parent: ['kid'], kid: ['grandkid'] })

    // The run must leave the registry for the stop to resolve; mirror what teardown does.
    for (const id of ['parent', 'kid', 'grandkid']) {
      const abort = state.activeRuns.get(id)!
      abort.signal.addEventListener('abort', () => state.activeRuns.delete(id))
    }
    await stopSession(ctx, 'parent')

    expect(stopped.sort()).toEqual(['grandkid', 'kid', 'parent'])
    // The children were taken down BY the parent's stop — that is what keeps their run ends from
    // each announcing a stop of their own; the parent itself was stopped by the person.
    expect([...state.cascadeStoppedSessionIds].sort()).toEqual(['grandkid', 'kid'])
  })

  test('a replace-run leaves children alone — the session continues and still wants their reports', async () => {
    const { ctx, state, stopped } = harness({ parent: ['kid'] })
    const abort = state.activeRuns.get('parent')!
    abort.signal.addEventListener('abort', () => state.activeRuns.delete('parent'))

    await stopSession(ctx, 'parent', 'replace-run')

    expect(stopped).toEqual(['parent'])
  })

  test('a cycle in the parent chain cannot turn Stop into a hang', async () => {
    // Corrupted data, not a legal shape — but Stop must terminate regardless.
    const { ctx, state, stopped } = harness({ parent: ['kid'], kid: ['parent'] })
    for (const id of ['parent', 'kid']) {
      const abort = state.activeRuns.get(id)!
      abort.signal.addEventListener('abort', () => state.activeRuns.delete(id))
    }

    await stopSession(ctx, 'parent')

    expect(stopped.sort()).toEqual(['kid', 'parent'])
  })
})
