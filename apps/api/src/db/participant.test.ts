import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_HANDLE as DEFINITION_DEFAULT_HANDLE } from '@localixai/agent/agents'
import {
  agentParticipant,
  conversationAgent,
  DEFAULT_AGENT_HANDLE,
  isAgentParticipant,
  participantAgentId,
  SYSTEM_PARTICIPANT,
  USER_PARTICIPANT,
} from './participant'

describe('participant refs', () => {
  test('the tag separates the kind from the name, which a bare handle could not', () => {
    // `user` and `system` are legal agent handles, so an untagged name would be ambiguous
    // exactly where it matters most.
    expect(agentParticipant('user')).toBe('agent:user')
    expect(isAgentParticipant('agent:user')).toBe(true)
    expect(isAgentParticipant(USER_PARTICIPANT)).toBe(false)
    expect(isAgentParticipant(SYSTEM_PARTICIPANT)).toBe(false)
    // A bare prefix names no one.
    expect(isAgentParticipant('agent:')).toBe(false)
  })

  test('the handle round-trips, and the human and the app have none', () => {
    expect(participantAgentId(agentParticipant('alice'))).toBe('alice')
    expect(participantAgentId(USER_PARTICIPANT)).toBeNull()
    expect(participantAgentId(SYSTEM_PARTICIPANT)).toBeNull()
  })

  test('the agent side of a conversation is its first participant', () => {
    expect(conversationAgent([{ agentId: 'alice' }])).toBe('agent:alice')
    expect(conversationAgent([{ agentId: 'alice' }, { agentId: 'bob' }])).toBe('agent:alice')
    expect(() => conversationAgent([])).toThrow('no agent assignment')
  })

  test('the storage vocabulary and the agent definitions agree on the default handle', () => {
    // The agent package cannot import the API's storage layer, so the constant is stated twice.
    // This is the assertion that keeps the two copies honest.
    expect(DEFAULT_AGENT_HANDLE).toBe(DEFINITION_DEFAULT_HANDLE)
  })
})
