import { describe, expect, test } from 'bun:test'

import type { SessionAgentRoute } from '../features/chat/contracts/read-model'
import { agentRoute, chosenRoute, isMultiParticipant } from './session-route'

function participant(agentId: string, modelId: string): SessionAgentRoute {
  return {
    agentId,
    handle: agentId,
    providerConnectionId: `conn-${agentId}`,
    modelId,
    reasoningEffort: 'medium',
  }
}

const conversation = { agents: [participant('qa', 'fast'), participant('dev', 'strong')] }

describe('agentRoute — explicit execution identity', () => {
  test('resolves a speaker without changing participant order', () => {
    expect(agentRoute(conversation, 'dev')).toMatchObject({
      modelId: 'strong',
      providerConnectionId: 'conn-dev',
    })
    expect(conversation.agents.map((route) => route.agentId)).toEqual(['qa', 'dev'])
  })

  test('a departed participant has no executable route', () => {
    expect(agentRoute(conversation, 'ghost')).toBeUndefined()
  })

  test('isMultiParticipant tolerates a partial record', () => {
    // Narrow harnesses build a session out of the fields their case is about; a multi-participant
    // check is never the thing that should fail such a run.
    expect(isMultiParticipant({})).toBe(false)
    expect(isMultiParticipant({ agents: [participant('qa', 'fast')] })).toBe(false)
    expect(isMultiParticipant(conversation)).toBe(true)
  })
})

describe('chosenRoute — what a copy of a conversation may carry', () => {
  test('a model the conversation chose travels into the copy', () => {
    const chosen = chosenRoute({ ...participant('qa', 'fast'), modelOrigin: 'session' })
    expect(chosen.modelId).toBe('fast')
    expect(chosen.providerConnectionId).toBe('conn-qa')
  })

  test('a copy carries the stored seat as it is', () => {
    // Every seat holds an explicit route; a fork runs on exactly what its source runs on.
    const chosen = chosenRoute({ ...participant('qa', 'fast'), modelOrigin: 'project' })
    expect(chosen.modelId).toBe('fast')
  })

  test('the level always travels, whatever the model did', () => {
    // Effort is settled when a seat is created and belongs to the conversation from then on,
    // so a branch of a `max` discussion is a `max` discussion.
    const parent = {
      ...participant('qa', 'fast'),
      reasoningEffort: 'max' as const,
      modelOrigin: 'agent' as const,
    }
    expect(chosenRoute(parent).reasoningEffort).toBe('max')
  })

  test('a route with no stated origin is taken at face value', () => {
    // Narrow projections and test harnesses build a route without asking the chain. Blanking
    // those would drop a model nobody was inheriting.
    expect(chosenRoute(participant('qa', 'fast')).modelId).toBe('fast')
  })
})
