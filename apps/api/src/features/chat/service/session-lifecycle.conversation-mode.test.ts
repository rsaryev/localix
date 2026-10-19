import { describe, expect, it } from 'bun:test'

import type { ConversationMode } from '../conversation-modes'
import { CONVERSATION_MODE_NOTICE } from '../conversation-modes'
import { updateSession, type SessionLifecycleCtx } from './session-lifecycle'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'

/**
 * A mode switch is the person's statement about how the conversation works: one line the agents
 * read, and — leaving a group — the colleague handoffs it queued are dropped. Solo is one agent,
 * so a group of several is never made solo by removing anyone silently.
 */
function harness(mode: ConversationMode, over: Partial<SessionRecord> = {}) {
  let record: SessionRecord = sessionFixture({
    id: 's1',
    userId: 'u1',
    agents: routedParticipants({ modelId: 'm' }),
    conversationMode: mode,
    ...over,
  })
  const lines: string[] = []
  const cancelled: string[] = []
  const ctx = {
    now: () => '2026-01-02 00:00:00',
    requireSession: async () => record,
    getSessionDetail: async () => ({}) as never,
    publishSession: () => {},
    streamRegistry: { publish: () => {} },
    cancelColleagueChains: async (_u: string, id: string) => {
      cancelled.push(id)
    },
    repo: {
      updateSession: async (_u: string, _id: string, patch: Partial<SessionRecord>) => {
        record = { ...record, ...patch }
      },
      insertMessage: async (message: PersistedMessage) => {
        lines.push(String(message.payload.content))
      },
    },
  } as unknown as SessionLifecycleCtx
  return { ctx, lines, cancelled, record: () => record }
}

describe('a conversation mode change', () => {
  it('making a chat a group writes one line and drops nothing', async () => {
    const { ctx, lines, cancelled, record } = harness('solo')
    await updateSession(ctx, 'u1', 's1', { conversationMode: 'group' })
    expect(record().conversationMode).toBe('group')
    expect(lines).toEqual([CONVERSATION_MODE_NOTICE.group])
    expect(cancelled).toEqual([])
  })

  it('making a lone group solo writes its line and drops the colleague chains it queued', async () => {
    const { ctx, lines, cancelled } = harness('group')
    await updateSession(ctx, 'u1', 's1', { conversationMode: 'solo' })
    expect(lines).toEqual([CONVERSATION_MODE_NOTICE.solo])
    expect(cancelled).toEqual(['s1'])
  })

  it('re-sending the current mode says nothing', async () => {
    const { ctx, lines, cancelled } = harness('solo')
    await updateSession(ctx, 'u1', 's1', { conversationMode: 'solo' })
    expect(lines).toEqual([])
    expect(cancelled).toEqual([])
  })

  it('a group of several is never made solo by quietly removing anyone', async () => {
    const { ctx, record } = harness('group', {
      agents: [...routedParticipants({ handle: 'lead' }), ...routedParticipants({ handle: 'qa' })],
    })
    await expect(
      updateSession(ctx, 'u1', 's1', { conversationMode: 'solo' }),
    ).rejects.toMatchObject({ status: 409, code: 'solo_needs_one_agent' })
    expect(record().conversationMode).toBe('group')
  })

  it('a session that is not a chat has no conversation mode to change', async () => {
    const { ctx } = harness('group', {
      sessionKind: 'subagent',
      parentSessionId: 'root',
      rootSessionId: 'root',
    })
    await expect(
      updateSession(ctx, 'u1', 's1', { conversationMode: 'solo' }),
    ).rejects.toMatchObject({ status: 409, code: 'membership_fixed' })
  })
})
