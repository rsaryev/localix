import { describe, expect, test } from 'bun:test'
import type { ChatStore } from './store'
import { inheritedAgentId } from './newChatAgent'

/**
 * "New chat" says nothing about an agent, and the server's answer for "nobody said" is the
 * default assistant — so pressing + while talking to @qa dropped you into a chat with
 * somebody else, and the agent menu was the only way back.
 */
const session = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    projectId: 'PRJ-1',
    sessionKind: 'chat',
    agents: [{ agentId: 'builtin:qa', handle: 'qa' }],
    ...over,
  }) as never

const store = (active: unknown, id: string | null = 's1') =>
  ({
    activeSessionId: id,
    sessions: active ? [active] : [],
    allSessions: active ? [active] : [],
  }) as unknown as ChatStore

describe('whom a new chat is with when nobody said', () => {
  test('the agent of the chat you are in', () => {
    expect(inheritedAgentId(store(session()), 'PRJ-1')).toBe('builtin:qa')
  })

  test('nothing when there is no open chat', () => {
    expect(inheritedAgentId(store(null, null), 'PRJ-1')).toBeUndefined()
  })

  /**
   * Both guards are about the inheritance being able to HOLD, not about taste: naming an
   * agent the target scope cannot resolve is a 404 instead of a chat.
   */
  test('nothing across a scope boundary — an agent can be project-scoped', () => {
    expect(inheritedAgentId(store(session()), 'PRJ-2')).toBeUndefined()
    expect(inheritedAgentId(store(session()), null)).toBeUndefined()
    expect(inheritedAgentId(store(session({ projectId: null })), null)).toBe('builtin:qa')
  })

  test('nothing from a worker or a dispatched job — that role may not be admitted to a chat', () => {
    expect(inheritedAgentId(store(session({ sessionKind: 'subagent' })), 'PRJ-1')).toBeUndefined()
    expect(inheritedAgentId(store(session({ sessionKind: 'job' })), 'PRJ-1')).toBeUndefined()
    // An older row with no kind at all is read as the chat it almost certainly is.
    expect(inheritedAgentId(store(session({ sessionKind: undefined })), 'PRJ-1')).toBe('builtin:qa')
  })

  test('nothing when the open chat has no party to inherit from', () => {
    expect(inheritedAgentId(store(session({ agents: [] })), 'PRJ-1')).toBeUndefined()
  })
})
