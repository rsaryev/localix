import { describe, expect, test } from 'bun:test'

import { createSessionSeatResolver, type SessionSeatAgents } from './session-seat'

const QA = { id: 'builtin:qa', handle: 'qa' }

function agents(overrides: Partial<SessionSeatAgents> = {}): SessionSeatAgents {
  return {
    resolveEnabledAgent: async () => QA,
    selectEnabledAgent: async () => QA,
    resolveInvocableAgent: async () => QA,
    ...overrides,
  }
}

describe('who may be seated in a session', () => {
  test('an enabled agent allowed in chat takes its seat', async () => {
    const seat = createSessionSeatResolver(agents())
    expect(await seat('u', { agentId: QA.id }, null, 'chat')).toEqual(QA)
  })

  test('an agent whose chat invocation is denied is refused the seat', async () => {
    // The alternative is seating it and letting the first turn fail in that agent's own voice,
    // as if the refusal were its answer — and in a group the others then read the policy error
    // as a colleague's contribution.
    const seat = createSessionSeatResolver(agents({ resolveInvocableAgent: async () => null }))
    expect(await seat('u', { agentId: QA.id }, null, 'chat')).toBeNull()
  })

  test('without a host the invocation policy is not consulted at all', async () => {
    // An engine creating its own worker session seats the agent it dispatched. Its `chat` policy
    // is denied on purpose for exactly those agents, and is beside the point here.
    let asked = false
    const seat = createSessionSeatResolver(
      agents({
        resolveInvocableAgent: async () => {
          asked = true
          return null
        },
      }),
    )
    expect(await seat('u', { agentId: QA.id }, null)).toEqual(QA)
    expect(asked).toBe(false)
  })

  test('an agent the registry does not know is refused before policy is asked', async () => {
    let asked = false
    const seat = createSessionSeatResolver(
      agents({
        resolveEnabledAgent: async () => null,
        resolveInvocableAgent: async () => {
          asked = true
          return QA
        },
      }),
    )
    expect(await seat('u', { agentId: 'builtin:ghost' }, null, 'chat')).toBeNull()
    expect(asked).toBe(false)
  })

  test('a handle resolves the same way an id does', async () => {
    const seat = createSessionSeatResolver(agents({ resolveEnabledAgent: async () => null }))
    expect(await seat('u', { handle: 'qa' }, null, 'chat')).toEqual(QA)
  })
})
