import { describe, expect, test } from 'bun:test'

import type { ChatStore } from './store'
import {
  activeConversationDraft,
  conversationCreationLatchKeys,
  resolveConversationStart,
  scopedNewConversation,
} from './conversationStartStrategy'

const state = (over: Partial<ChatStore> = {}) =>
  ({
    activeProjectId: 'project-a',
    activeSessionId: 'session-a',
    projects: [{ id: 'project-default', isDefault: true }],
    sessions: [],
    allSessions: [
      {
        id: 'session-a',
        projectId: 'project-a',
        sessionKind: 'chat',
        agents: [{ agentId: 'builtin:reviewer', handle: 'reviewer' }],
      },
    ],
    ...over,
  }) as ChatStore

describe('conversation start strategies', () => {
  test('an unresolved neutral scope resolves to the default project, never the stale active one', () => {
    expect(resolveConversationStart(state(), scopedNewConversation(null))).toEqual({
      projectId: 'project-default',
      agentId: 'builtin:localix',
      fallbackWhenAgentUnavailable: false,
    })
  })

  test('the server may resolve the default when its project roster has not loaded yet', () => {
    expect(resolveConversationStart(state({ projects: [] }), scopedNewConversation(null))).toEqual({
      projectId: null,
      agentId: 'builtin:localix',
      fallbackWhenAgentUnavailable: false,
    })
  })

  test('default-project creation keeps one latch identity across roster hydration', () => {
    expect(conversationCreationLatchKeys(state({ projects: [] }), { projectId: null })).toEqual([
      '__default__',
    ])
    expect(conversationCreationLatchKeys(state(), { projectId: 'project-default' })).toEqual([
      'project-default',
      '__default__',
    ])
    expect(conversationCreationLatchKeys(state(), { projectId: 'project-a' })).toEqual([
      'project-a',
    ])
  })

  test('the ordinary action inherits the current participant only inside the same scope', () => {
    expect(resolveConversationStart(state(), scopedNewConversation('project-a'))).toMatchObject({
      projectId: 'project-a',
      agentId: 'builtin:reviewer',
      fallbackWhenAgentUnavailable: true,
    })
    expect(resolveConversationStart(state(), scopedNewConversation('project-b'))).toMatchObject({
      projectId: 'project-b',
      agentId: 'builtin:localix',
      fallbackWhenAgentUnavailable: false,
    })
  })

  test('agent and scope policies compose independently', () => {
    expect(
      resolveConversationStart(
        state(),
        scopedNewConversation('project-b', {
          kind: 'agent',
          agentId: 'project-b:qa',
        }),
      ),
    ).toEqual({
      projectId: 'project-b',
      agentId: 'project-b:qa',
      fallbackWhenAgentUnavailable: false,
    })
  })

  test('the active-scope draft strategy is explicit about both axes', () => {
    expect(resolveConversationStart(state(), activeConversationDraft())).toMatchObject({
      projectId: 'project-a',
      agentId: 'builtin:reviewer',
    })
  })
})
