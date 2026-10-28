import { describe, expect, test } from 'bun:test'

import { createRuntimeState } from './agent-runner-state'
import { createRunnerQueue } from './agent-runner-queue'
import { testWork } from '../../../testing/work-fixture'

describe('stopping a session on the person behalf', () => {
  test('takes the queued messages before the run is aborted, and returns them', async () => {
    const state = createRuntimeState(testWork())
    const abort = new AbortController()
    state.activeRuns.set('s1', abort)
    const order: string[] = []
    const taken = [{ content: 'later', clientMessageId: 'c1' }]
    const queue = createRunnerQueue({
      state,
      wakeQueue: {
        cancelAgentTurns: async () => 0,
        takeForReturn: async () => {
          order.push(`take(aborted=${abort.signal.aborted})`)
          return taken
        },
      } as never,
      stopCtx: {
        state,
        repo: {} as never,
        streamRegistry: {} as never,
        now: () => 'now',
        markRuntimeSessionStatus: async (_u, session) => session,
      },
    })
    const stopping = queue.stopAndReturnQueued('u', 's1')
    await Promise.resolve()
    state.activeRuns.delete('s1')
    expect(await stopping).toEqual({ stopped: true, returned: taken })
    expect(order).toEqual(['take(aborted=false)'])
  })
})
