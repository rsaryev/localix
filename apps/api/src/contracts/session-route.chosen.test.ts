import { describe, expect, test } from 'bun:test'

import type { SessionAgentRoute } from '../features/chat/contracts/read-model'
import { agentRoute, chosenRoute } from './session-route'

function routeOf(agentId: string, modelId: string): SessionAgentRoute {
  return {
    agentId,
    name: agentId,
    providerConnectionId: `conn-${agentId}`,
    modelId,
    reasoningEffort: 'medium',
  }
}

const conversation = { agent: routeOf('dev', 'strong') }

describe('agentRoute — the session’s own agent', () => {
  test('is the session’s route', () => {
    expect(agentRoute(conversation)).toMatchObject({
      modelId: 'strong',
      providerConnectionId: 'conn-dev',
    })
  })

  test('a session without an agent has no executable route', () => {
    expect(agentRoute({ agent: null })).toBeUndefined()
  })
})

describe('chosenRoute — what a copy of a conversation may carry', () => {
  test('a model the conversation chose travels into the copy', () => {
    const chosen = chosenRoute({ ...routeOf('qa', 'fast'), modelOrigin: 'session' })
    expect(chosen.modelId).toBe('fast')
    expect(chosen.providerConnectionId).toBe('conn-qa')
  })

  test('a copy carries the stored route as it is', () => {
    // Every route holds an explicit route; a fork runs on exactly what its source runs on.
    const chosen = chosenRoute({ ...routeOf('qa', 'fast'), modelOrigin: 'project' })
    expect(chosen.modelId).toBe('fast')
  })

  test('the level always travels, whatever the model did', () => {
    // Effort is settled when a route is created and belongs to the conversation from then on,
    // so a branch of a `max` discussion is a `max` discussion.
    const parent = {
      ...routeOf('qa', 'fast'),
      reasoningEffort: 'max' as const,
      modelOrigin: 'agent' as const,
    }
    expect(chosenRoute(parent).reasoningEffort).toBe('max')
  })

  test('a route with no stated origin is taken at face value', () => {
    // Narrow projections and test harnesses build a route without asking the chain. Blanking
    // those would drop a model nobody was inheriting.
    expect(chosenRoute(routeOf('qa', 'fast')).modelId).toBe('fast')
  })
})
