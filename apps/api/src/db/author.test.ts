import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_NAME as DEFINITION_DEFAULT_HANDLE } from '@localixai/agent/agents'
import {
  agentAuthor,
  DEFAULT_AGENT_NAME,
  isAgentAuthor,
  authorAgentId,
  SYSTEM_AUTHOR,
  USER_AUTHOR,
} from './author'

describe('participant refs', () => {
  test('the tag separates the kind from the name, which a bare handle could not', () => {
    // `user` and `system` are legal agent handles, so an untagged name would be ambiguous
    // exactly where it matters most.
    expect(agentAuthor('user')).toBe('agent:user')
    expect(isAgentAuthor('agent:user')).toBe(true)
    expect(isAgentAuthor(USER_AUTHOR)).toBe(false)
    expect(isAgentAuthor(SYSTEM_AUTHOR)).toBe(false)
    // A bare prefix names no one.
    expect(isAgentAuthor('agent:')).toBe(false)
  })

  test('the handle round-trips, and the human and the app have none', () => {
    expect(authorAgentId(agentAuthor('alice'))).toBe('alice')
    expect(authorAgentId(USER_AUTHOR)).toBeNull()
    expect(authorAgentId(SYSTEM_AUTHOR)).toBeNull()
  })

  test('the storage vocabulary and the agent definitions agree on the default handle', () => {
    // The agent package cannot import the API's storage layer, so the constant is stated twice.
    // This is the assertion that keeps the two copies honest.
    expect(DEFAULT_AGENT_NAME).toBe(DEFINITION_DEFAULT_HANDLE)
  })
})
