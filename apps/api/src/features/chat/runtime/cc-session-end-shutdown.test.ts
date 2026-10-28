/**
 * Claude Code runs `SessionEnd` when you exit. A session that started in this process and is
 * still open when the API shuts down (the app quits) gets its hooks run, with reason
 * `prompt_input_exit`, inside Claude Code's 1.5 second budget, before the process goes.
 */
import { describe, expect, test } from 'bun:test'

import { testWork } from '../../../testing/work-fixture'
import { INERT_CC_HOOKS } from '../../cc-hooks'
import { createRunnerLifecycle } from './agent-runner-lifecycle'
import { createRuntimeState, endCcHookSessionsOnExit } from './agent-runner-state'
import type { RunnerDeps } from './agent-runner-types'

function lifecycle(runSessionEnd: (sessionId: string, reason: string) => Promise<void>) {
  const state = createRuntimeState(testWork())
  state.ccHookSessions.runtimeFor = (sessionId) => ({
    ...INERT_CC_HOOKS,
    active: true,
    runSessionEnd: (reason) => runSessionEnd(sessionId, reason),
  })
  const run = createRunnerLifecycle({
    deps: { agentRuntime: { disposeSession: async () => {} } } as unknown as RunnerDeps,
    state,
    wakeQueue: { close: async () => {} } as never,
  })
  return { state, run }
}

describe('SessionEnd at shutdown', () => {
  test('runs for each session that started, with reason prompt_input_exit, and waits for it', async () => {
    const ends: string[] = []
    let finish: () => void = () => {}
    const hookDone = new Promise<void>((resolve) => (finish = resolve))
    const { state } = lifecycle(async (id, reason) => {
      await hookDone
      ends.push(`${id} ${reason}`)
    })
    state.ccHooksStartedSessions.add('s1')
    state.ccHooksStartedSessions.add('s2')
    let settled = false
    const exiting = endCcHookSessionsOnExit(state, 60_000).then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    await exiting
    expect(ends.sort()).toEqual(['s1 prompt_input_exit', 's2 prompt_input_exit'])
  })

  test('does not run for a session that never started, nor twice', async () => {
    const ends: string[] = []
    const { state, run } = lifecycle(async (id) => {
      ends.push(id)
    })
    state.ccHooksStartedSessions.add('s1')
    await run.shutdown()
    await run.shutdown()
    expect(ends).toEqual(['s1'])
  })

  test('a hook that outlasts the budget does not hold the shutdown', async () => {
    const { state } = lifecycle(() => new Promise(() => {}))
    state.ccHooksStartedSessions.add('s1')
    await endCcHookSessionsOnExit(state, 1)
    expect(state.ccHooksStartedSessions.size).toBe(0)
  })
})
