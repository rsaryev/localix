import { expect, test } from 'bun:test'

import { sessionFixture } from '../../../../testing/session-fixture'
import { sessionExecutionContext } from '../execution-context'
import { dispatchParams } from '../run-params'
import { createHandoffPort } from './handoff-port'

const member = (agentId: string, handle: string) => ({
  agentId,
  handle,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'medium' as const,
})

function port(options: { rosterLocked?: boolean } = {}) {
  const session = sessionFixture({
    agents: [member('agent-a', 'alpha'), member('agent-b', 'beta')],
    ...(options.rosterLocked ? { rosterLocked: true } : {}),
  })
  const state = { handoffs: [] as string[] }
  const params = dispatchParams(
    { userId: session.userId, session, assistantMessageId: 'reply', historyMessages: [] },
    { speakerAgentId: 'agent-a', executionContext: sessionExecutionContext(session) },
  )
  const env = {
    deps: {
      listInvocableRegistryAgents: async () => [
        { agentId: 'agent-q', name: 'qa', description: 'Quality' },
        { agentId: 'agent-b', name: 'beta', description: 'Already here' },
      ],
    },
  }
  return { hand: createHandoffPort(env as never, params, state).hand, state }
}

test('records colleagues and invitable agents, canonicalising case and a leading @', async () => {
  const p = port()
  const outcome = await p.hand(['@BETA', 'qa', 'beta'])
  expect(outcome.handed).toEqual(['beta', 'qa'])
  expect(outcome.unknown).toEqual([])
  expect(p.state.handoffs).toEqual(['beta', 'qa'])
  await p.hand(['qa'])
  expect(p.state.handoffs).toEqual(['beta', 'qa'])
})

test('the speaker, the person and strangers are unknown and never recorded', async () => {
  const p = port()
  const outcome = await p.hand(['alpha', 'user', 'ghost'])
  expect(outcome.handed).toEqual([])
  expect(outcome.unknown).toEqual(['alpha', 'user', 'ghost'])
  expect(outcome.available).toEqual(['beta', 'qa'])
  expect(p.state.handoffs).toEqual([])
})

test('a fixed room offers only the participants already in it', async () => {
  const p = port({ rosterLocked: true })
  const outcome = await p.hand(['qa', 'beta'])
  expect(outcome.handed).toEqual(['beta'])
  expect(outcome.unknown).toEqual(['qa'])
})
