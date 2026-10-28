import { describe, expect, test } from 'bun:test'

import { agentChoiceRoute } from './agent-model-route'

describe('the route the person chose for an agent', () => {
  test('a chosen model and effort, with the connection when one was named', () => {
    const choices = [
      { agentId: 'a', providerConnectionId: 'conn', modelId: 'gpt-6', effort: 'high' as const },
    ]
    expect(agentChoiceRoute(choices, 'a')).toEqual({
      modelId: 'gpt-6',
      providerConnectionId: 'conn',
      reasoningEffort: 'high',
    })
  })

  test('an agent with no choice has no route, so it inherits its parent’s', () => {
    expect(agentChoiceRoute([{ agentId: 'a', modelId: 'x' }], 'b')).toEqual({})
    expect(agentChoiceRoute(undefined, 'a')).toEqual({})
  })
})
