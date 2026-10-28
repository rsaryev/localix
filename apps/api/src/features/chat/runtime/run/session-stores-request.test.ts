/** `/compact` arms the session's next turn. */
import { describe, expect, test } from 'bun:test'

import { testWork } from '../../../../testing/work-fixture'
import { createRuntimeState } from '../agent-runner-state'
import { requestCheckpoint } from './session-stores'

describe('requestCheckpoint', () => {
  test('arms the session with the instructions, and only that session', () => {
    const state = createRuntimeState(testWork())
    requestCheckpoint(state, 's1', 'keep the plan')
    expect(state.contextLanes.get('s1')?.manualCompact).toEqual({ instructions: 'keep the plan' })
    expect(state.contextLanes.get('s2')).toBeUndefined()
  })
})
