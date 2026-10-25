import { describe, expect, test } from 'bun:test'

import { agentModelDefaults } from './agent-model-defaults'
import type { AgentRecord } from './contracts'

const agent = (id: string, modelPreference?: AgentRecord['modelPreference']) => ({
  record: {
    id,
    handle: id,
    description: 'x',
    instructions: 'x',
    leadershipPriority: 0,
    ...(modelPreference ? { modelPreference } : {}),
  },
})

describe('the route an agent’s file starts a seat on', () => {
  test('a model with its provider is spelled as the catalog does; the connection is left open', () => {
    const routes = agentModelDefaults([
      agent('a', { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'high' }),
      agent('b', { provider: 'openai', model: 'openai/gpt-6' }),
      agent('c', { model: 'gpt-6-luna' }),
    ])
    expect(routes.get('a')).toEqual({
      modelId: 'anthropic/claude-sonnet-5',
      providerConnectionId: null,
      reasoningEffort: 'high',
    })
    expect(routes.get('b')).toEqual({ modelId: 'openai/gpt-6', providerConnectionId: null })
    expect(routes.get('c')).toEqual({ modelId: 'gpt-6-luna', providerConnectionId: null })
  })

  test('an effort alone is kept; an agent with no preference is skipped', () => {
    const routes = agentModelDefaults([agent('a', { effort: 'low' }), agent('c')])
    expect(routes.get('a')).toEqual({ reasoningEffort: 'low' })
    expect(routes.has('c')).toBe(false)
  })
})
