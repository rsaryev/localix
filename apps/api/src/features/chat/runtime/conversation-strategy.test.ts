import { describe, expect, test } from 'bun:test'

import { routedAgent } from '../../../testing/session-fixture'
import { turnRecipient } from './conversation-strategy'

const session = { agent: routedAgent({ agentId: 'builtin:lead', name: 'lead' }) }

describe('who answers a turn', () => {
  test('the person’s message goes to the conversation’s agent', () => {
    expect(turnRecipient(session, { kind: 'user-message', text: '@qa please check' })).toEqual({
      agentId: 'builtin:lead',
      source: 'user-default',
    })
  })

  test('a runtime delivery goes to the session’s agent', () => {
    expect(turnRecipient(session, { kind: 'runtime' })).toEqual({
      agentId: 'builtin:lead',
      source: 'runtime',
    })
  })

  test('a session without an agent has nobody to answer', () => {
    expect(turnRecipient({ agent: null }, { kind: 'user-message', text: 'hi' })).toBeUndefined()
  })
})
