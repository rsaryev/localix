import { describe, expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { rootExecutionContext } from '../execution-context'
import type { RunParams } from '../run-contract'
import type { AgentTurnTicket } from '../agent-turn-ticket'
import { dispatchAgentTicket } from './dispatch-agent'

/**
 * A slash command's `model:` override used to be applied to the ENQUEUING caller's session
 * snapshot, while the dispatcher re-reads the session when the ticket runs — so the override
 * never reached the run. It now rides the ticket's scope and is applied here, on a copy.
 */
describe('dispatchAgentTicket — per-run model override', () => {
  const run = async (modelOverride?: string) => {
    const session = sessionFixture({ id: 's1' })
    const agentId = session.agents[0]!.agentId
    const ticket: AgentTurnTicket = {
      speakerAgentId: agentId,
      assistantMessageId: 'a1',
      triggerMessageIds: [],
      source: 'user-default',
      scope: {
        speakerAgentId: agentId,
        executionContext: rootExecutionContext(),
        ...(modelOverride ? { modelOverride } : {}),
      },
    }
    let dispatched: RunParams | undefined
    await dispatchAgentTicket(
      { userId: session.userId, session, ticket, consume: async () => {} },
      {
        repo: { listMessages: async () => [], insertMessage: async () => {} } as never,
        streamRegistry: { publish: () => {} } as never,
        now: () => '2026-09-23T00:00:00.000Z',
        run: async (params) => {
          dispatched = params
          return { status: 'completed' } as never
        },
      },
    )
    return { session, agentId, dispatched: dispatched! }
  }

  test('the run gets the override; the session record keeps the user choice', async () => {
    const { session, agentId, dispatched } = await run('override-model')
    const route = (s: typeof session) => s.agents.find((a) => a.agentId === agentId)!.modelId
    expect(route(dispatched.session)).toBe('override-model')
    expect(route(session)).not.toBe('override-model')
  })

  test('without an override the session is passed through untouched', async () => {
    const { session, dispatched } = await run()
    expect(dispatched.session).toBe(session)
  })
})
