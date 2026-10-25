import { describe, expect, test } from 'bun:test'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { agentPolicy, canEditField, canJoinConversation } from './policy'

const record = (id: string) => ({ id, handle: 'x', description: '', instructions: 'x' }) as never

describe('agent policy', () => {
  test('a file the person owns is edited, deleted and copied; the rest is copied only', () => {
    const own = agentPolicy({ record: record('cc:1'), editable: true })
    expect(canEditField(own, 'name')).toBe(true)
    expect(own).toMatchObject({ delete: true, duplicate: true, disable: true })
    const shipped = agentPolicy({ record: record('builtin:Explore'), editable: false })
    expect(shipped.editable).toEqual([])
    expect(shipped).toMatchObject({ delete: false, duplicate: true })
  })

  test('the main loop cannot be switched off', () => {
    expect(agentPolicy({ record: record(DEFAULT_AGENT_ID), editable: false }).disable).toBe(false)
  })

  test('joining a conversation needs the agent on and its chat invocation allowed', () => {
    expect(canJoinConversation({ enabled: true, invocations: { chat: 'allow' } })).toBe(true)
    expect(canJoinConversation({ enabled: true, invocations: { chat: 'ask' } })).toBe(false)
    expect(canJoinConversation({ enabled: false, invocations: { chat: 'allow' } })).toBe(false)
  })
})
