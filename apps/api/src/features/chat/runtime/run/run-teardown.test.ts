/// <reference types="bun" />

/**
 * IDEMPOTENCY / RE-ENTRANCY guard for `teardownRun`.
 *
 * teardownRun runs in executeRun's `finally`, once per run. The delicate part is the
 * CONTINUATION guard: hook-stop / wake continuations delete this run's entry and
 * synchronously spawn a NEW run that re-registers the SAME session id (with a fresh
 * AbortController) BEFORE this finally executes. An unconditional cleanup here would
 * remove the NEW run's AbortController — runner.stop() would then silently fail to abort
 * it and isRunning() would lie.
 *
 * The guard is `ownsSession = activeRuns.get(session.id) === abort`: only the run that
 * STILL owns the registry entry clears it. This test drives the two ways the guard is
 * exercised — a continuation that stole the session, and a plain double teardown of the
 * same run — and asserts teardown is safe to run when it no longer owns the entry.
 *
 * Principle: Release It! — a resource (the activeRuns entry) touched by two flows needs
 * an owner; the owner here is the run whose abort is still registered.
 */

import { describe, expect, test } from 'bun:test'

import { createRuntimeState } from '../agent-runner-state'
import { testWork } from '../../../../testing/work-fixture'
import type { SessionRecord } from '../../repository'
import { teardownRun } from './run-teardown'
import type { RunEnv } from './types'

function makeEnv() {
  const settled: string[] = []
  const env = {
    deps: { hitlRegistry: { clearSource: (id: string) => settled.push(id) } },
    hasPendingQueue: () => false,
    drainPendingAndRun: async () => {},
  } as unknown as RunEnv
  return { env, settled }
}

const session = {
  id: 's1',
  userId: 'u1',
  sessionKind: 'chat',
  parentSessionId: null,
  provenance: { kind: 'root' },
} as unknown as SessionRecord

function baseArgs(
  env: RunEnv,
  runtimeState: ReturnType<typeof createRuntimeState>,
  abort: AbortController,
) {
  return {
    env,
    runtimeState,
    session,
    abort,
    pluginHooksForRun: [],
    ccHooksForRun: undefined,
    runLiveResolverKeys: new Set<string>(),
    unsubLsp: undefined,
    defaultCwd: undefined,
  }
}

describe('teardownRun — continuation / re-entrancy guard', () => {
  test('the OWNING run clears its registry entries', () => {
    const { env, settled } = makeEnv()
    const state = createRuntimeState(testWork())
    const abort = new AbortController()
    state.activeRuns.set(session.id, abort)
    state.activeRunSessions.set(session.id, { userId: 'u1', session })
    state.stoppedRuntimeSessionIds.add(session.id)

    teardownRun(baseArgs(env, state, abort))

    expect(state.activeRuns.has(session.id)).toBe(false)
    expect(state.activeRunSessions.has(session.id)).toBe(false)
    // A stopped run may never emit its tool end: the questions it still holds are settled.
    expect(settled).toEqual([session.id])
    expect(state.stoppedRuntimeSessionIds.has(session.id)).toBe(false)
  })

  test('a continuation that re-registered the session survives an old run teardown', () => {
    const { env, settled } = makeEnv()
    const state = createRuntimeState(testWork())
    const abortA = new AbortController()
    state.activeRuns.set(session.id, abortA)
    state.activeRunSessions.set(session.id, { userId: 'u1', session })

    // Continuation stole the session before A's finally ran: NEW abort under the same id.
    const abortB = new AbortController()
    state.activeRuns.set(session.id, abortB)
    state.activeRunSessions.set(session.id, { userId: 'u1', session })

    teardownRun(baseArgs(env, state, abortA))
    // The continuation's questions are its own; the old run must not settle them.
    expect(settled).toEqual([])

    // B's entry must be intact — teardown of A did not clear the continuation.
    expect(state.activeRuns.get(session.id)).toBe(abortB)
    expect(state.activeRunSessions.has(session.id)).toBe(true)
  })

  test('a second teardown of the SAME run is a no-op', () => {
    const { env } = makeEnv()
    const state = createRuntimeState(testWork())
    const abort = new AbortController()
    state.activeRuns.set(session.id, abort)
    state.activeRunSessions.set(session.id, { userId: 'u1', session })

    teardownRun(baseArgs(env, state, abort))
    // Second call: the entry is gone, so ownsSession is false → no map churn.
    teardownRun(baseArgs(env, state, abort))

    expect(state.activeRuns.has(session.id)).toBe(false)
  })
})
