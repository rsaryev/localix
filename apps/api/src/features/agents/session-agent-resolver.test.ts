import { describe, expect, test } from 'bun:test'

import { createSessionAgentResolver, type SessionAgentRegistry } from './session-agent-resolver'

const QA = { id: 'builtin:qa', name: 'qa' }

function agents(overrides: Partial<SessionAgentRegistry> = {}): SessionAgentRegistry {
  return {
    resolveEnabledAgent: async () => QA,
    selectEnabledAgent: async () => QA,
    resolveInvocableAgent: async () => QA,
    ...overrides,
  }
}

describe('who may be used by a session', () => {
  test('an enabled agent allowed in chat takes its route', async () => {
    const route = createSessionAgentResolver(agents())
    expect(await route('u', { agentId: QA.id }, null, 'chat')).toEqual(QA)
  })

  test('an agent whose chat invocation is denied is refused', async () => {
    // The alternative is choosing it and letting the first turn fail in that agent's own voice,
    // as if the refusal were its answer.
    const route = createSessionAgentResolver(agents({ resolveInvocableAgent: async () => null }))
    expect(await route('u', { agentId: QA.id }, null, 'chat')).toBeNull()
  })

  test('without a host the invocation policy is not consulted at all', async () => {
    // An engine creating its own worker session uses the agent it dispatched. Its `chat` policy
    // is denied on purpose for exactly those agents, and is beside the point here.
    let asked = false
    const route = createSessionAgentResolver(
      agents({
        resolveInvocableAgent: async () => {
          asked = true
          return null
        },
      }),
    )
    expect(await route('u', { agentId: QA.id }, null)).toEqual(QA)
    expect(asked).toBe(false)
  })

  test('an agent the registry does not know is refused before policy is asked', async () => {
    let asked = false
    const route = createSessionAgentResolver(
      agents({
        resolveEnabledAgent: async () => null,
        resolveInvocableAgent: async () => {
          asked = true
          return QA
        },
      }),
    )
    expect(await route('u', { agentId: 'builtin:ghost' }, null, 'chat')).toBeNull()
    expect(asked).toBe(false)
  })

  test('a name resolves the same way an id does', async () => {
    const route = createSessionAgentResolver(agents({ resolveEnabledAgent: async () => null }))
    expect(await route('u', { name: 'qa' }, null, 'chat')).toEqual(QA)
  })
})
