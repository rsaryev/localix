/**
 * Claude Code's SessionEnd runs "when a session terminates", with the reason it ended. A run
 * ending is not a session ending: the hooks run on `/clear` (reason `clear`) and when the session
 * is deleted (reason `other`), never per run or on a context checkpoint.
 */
import { describe, expect, test } from 'bun:test'

import { testWork } from '../../../testing/work-fixture'
import { INERT_CC_HOOKS } from '../../cc-hooks'
import { noteNextSessionStartSource } from './agent-runner-lifecycle'
import { createRuntimeState, forgetSessionRuntimeState } from './agent-runner-state'

function stateWithEnds() {
  const state = createRuntimeState(testWork())
  const ends: string[] = []
  state.ccHookSessions.runtimeFor = (sessionId) => ({
    ...INERT_CC_HOOKS,
    active: true,
    runSessionEnd: async (reason) => {
      ends.push(`${sessionId} ${reason}`)
    },
  })
  return { state, ends }
}

describe('SessionEnd', () => {
  test('runs with reason clear when the session is cleared, not on a checkpoint', () => {
    const { state, ends } = stateWithEnds()
    noteNextSessionStartSource(state, 's1', 'compact')
    expect(ends).toEqual([])
    noteNextSessionStartSource(state, 's1', 'clear')
    expect(ends).toEqual(['s1 clear'])
  })

  test('runs with reason other when the session is deleted', () => {
    const { state, ends } = stateWithEnds()
    forgetSessionRuntimeState(state, 's1')
    expect(ends).toEqual(['s1 other'])
  })
})
