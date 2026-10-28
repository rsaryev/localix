import { describe, expect, test } from 'bun:test'

import { agentModelDefaults } from './agent-model-defaults'

describe('the route the person chose for an agent', () => {
  test('a chosen model keeps its spelling and leaves the connection open', () => {
    const routes = agentModelDefaults([
      { agentId: 'a', modelId: 'anthropic/claude-sonnet-5', effort: 'high' },
      { agentId: 'b', modelId: 'gpt-6-luna', providerConnectionId: 'conn-1' },
    ])
    expect(routes.get('a')).toEqual({
      modelId: 'anthropic/claude-sonnet-5',
      providerConnectionId: null,
      reasoningEffort: 'high',
    })
    expect(routes.get('b')).toEqual({ modelId: 'gpt-6-luna', providerConnectionId: 'conn-1' })
  })

  test('an effort alone is kept; an agent with no choice has no route', () => {
    const routes = agentModelDefaults([{ agentId: 'a', effort: 'low' }])
    expect(routes.get('a')).toEqual({ reasoningEffort: 'low' })
    expect(routes.has('c')).toBe(false)
    expect(agentModelDefaults(undefined).size).toBe(0)
  })
})
