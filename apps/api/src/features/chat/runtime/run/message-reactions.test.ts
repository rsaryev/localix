import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { agentParticipant, USER_PARTICIPANT, type ParticipantRef } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import type { AgentStreamEvent } from '../../contracts'
import { createChatRepository } from '../../repository'
import { createSessionStreamRegistry } from '../session-stream-registry'
import { setMessageReaction, type MessageReactionIo } from './message-reactions'

describe('persisted message reactions', () => {
  const userId = 'user-1'
  const sessionId = 'session-1'
  const messageId = 'message-1'
  const createdAt = '2026-01-01T00:00:00.000Z'
  const at = '2026-01-01T00:01:00.000Z'
  let db: ReturnType<typeof createDatabase>
  let io: MessageReactionIo
  let events: AgentStreamEvent[]
  let unsubscribe: () => void

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(sessionFixture())
    await repo.insertMessage({
      id: messageId,
      userId,
      sessionId,
      payload: { id: messageId, role: 'user', from: USER_PARTICIPANT, content: 'Keep this text' },
      createdAt,
      updatedAt: createdAt,
    })
    const streamRegistry = createSessionStreamRegistry()
    io = { repo, streamRegistry, now: () => at }
    events = []
    unsubscribe = streamRegistry.subscribe(sessionId, ({ event }) => events.push(event))
  })

  afterEach(async () => {
    unsubscribe()
    await destroyDatabase(db)
  })

  const react = (from: ParticipantRef = USER_PARTICIPANT, emoji = '👍', remove = false) =>
    setMessageReaction(io, {
      userId,
      sessionId,
      messageId,
      from,
      emoji,
      remove,
    })

  test('a retry neither duplicates a mark nor publishes an unchanged snapshot', async () => {
    expect(await react()).toBe(true)
    const stored = await io.repo.getMessage(userId, sessionId, messageId)
    assert(stored, 'the reacted message must remain persisted')
    expect(stored?.payload).toMatchObject({
      content: 'Keep this text',
      reactions: [{ emoji: '👍', from: USER_PARTICIPANT, at }],
    })
    expect(events).toEqual([{ type: 'message.updated', sessionId, message: stored }])

    io.now = () => '2026-01-01T00:02:00.000Z'
    expect(await react()).toBe(false)
    expect(await io.repo.getMessage(userId, sessionId, messageId)).toEqual(stored)
    expect(events).toHaveLength(1)
  })

  test('removal preserves other authors and other emoji, publishing the stored result', async () => {
    const agent = agentParticipant('builtin:localix')
    await react()
    await react(agent)
    await react(USER_PARTICIPANT, '🎉')
    events.length = 0

    expect(await react(USER_PARTICIPANT, '👍', true)).toBe(true)
    const stored = await io.repo.getMessage(userId, sessionId, messageId)
    assert(stored, 'removing a reaction must preserve the message')
    expect(stored?.payload.reactions).toEqual([
      { emoji: '👍', from: agent, at },
      { emoji: '🎉', from: USER_PARTICIPANT, at },
    ])
    expect(events).toEqual([{ type: 'message.updated', sessionId, message: stored }])
    expect(await react(USER_PARTICIPANT, '👍', true)).toBe(false)
    expect(events).toHaveLength(1)
  })

  test('a missing message or a different owner cannot change or publish the row', async () => {
    for (const overrides of [{ messageId: 'gone' }, { userId: 'someone-else' }]) {
      expect(
        await setMessageReaction(io, {
          userId,
          sessionId,
          messageId,
          from: USER_PARTICIPANT,
          emoji: '👍',
          ...overrides,
        }),
      ).toBe(false)
    }
    expect(
      (await io.repo.getMessage(userId, sessionId, messageId))?.payload.reactions,
    ).toBeUndefined()
    expect(events).toEqual([])
  })
})
