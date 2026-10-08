import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { sessionFixture } from '../../testing/session-fixture'
import { createChatRepository, toSessionSummary } from './repository'
import { bumpSessionForTurn } from './service/message-builders'
import type { PersistedMessage } from './contracts'
import { agentParticipant } from '../../db/participant'
import { serializeMessagePayload } from '../../db'

describe('shared session topic persistence', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>
  const original = sessionFixture({ title: 'New Chat' })
  const boundary = { messageId: 'topic-host', agentId: original.agents[0]!.agentId }
  const topic = {
    title: 'Release parser',
    goal: 'Ship the verified parser.',
    previousTopicSummary: 'Parser fixed; tests passed. Keep Bun. Deployment is pending.',
  }

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
    await repo.insertSession(original)
    await repo.insertMessage({
      id: boundary.messageId,
      sessionId: original.id,
      userId: original.userId,
      payload: {
        id: boundary.messageId,
        role: 'assistant',
        from: agentParticipant(boundary.agentId),
        content: 'Public reply remains in the transcript.',
      },
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    })
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('legacy sessions read null fields and topic writes round-trip through the read model', async () => {
    const before = (await repo.getSession(original.userId, original.id))!
    expect(before).toMatchObject({ goal: null, previousTopicSummary: null })
    expect(
      await repo.updateSessionTopic(
        original.userId,
        original.id,
        before,
        topic,
        '2026-10-08',
        boundary,
      ),
    ).toBe(true)
    const after = (await repo.getSession(original.userId, original.id))!
    expect(after).toMatchObject(topic)
    expect(toSessionSummary(after)).toMatchObject(topic)
    expect(after.agents).toEqual(before.agents)
    expect(
      (await repo.getMessage(original.userId, original.id, boundary.messageId))?.payload,
    ).toMatchObject({
      contextBoundary: true,
      content: 'Public reply remains in the transcript.',
    })
  })

  test('a stale or foreign author cannot replace any part of a newer topic', async () => {
    expect(
      await repo.updateSessionTopic(
        'other-user',
        original.id,
        original,
        topic,
        '2026-10-08',
        boundary,
      ),
    ).toBe(false)
    expect(
      await repo.updateSessionTopic(
        original.userId,
        original.id,
        original,
        topic,
        '2026-10-08',
        boundary,
      ),
    ).toBe(true)
    expect(
      await repo.updateSessionTopic(
        original.userId,
        original.id,
        original,
        { ...topic, title: 'Stale' },
        '2026-10-09',
        boundary,
      ),
    ).toBe(false)
    expect(await repo.getSession(original.userId, original.id)).toMatchObject(topic)
  })

  test('a late automatic title and objective cannot erase an agent topic change', async () => {
    await repo.seedSessionTopic(original.userId, original.id, 'Check parser', 'Check parser')
    const before = (await repo.getSession(original.userId, original.id))!
    expect(
      await repo.updateTitleIfCurrent(
        original.userId,
        original.id,
        'Check parser',
        'Parser review',
        'Review parser.',
        'Check parser',
      ),
    ).toBe(true)
    const generated = (await repo.getSession(original.userId, original.id))!
    expect(generated).toMatchObject({
      title: 'Parser review',
      goal: 'Review parser.',
      previousTopicSummary: null,
    })
    await repo.updateSessionTopic(
      original.userId,
      original.id,
      generated,
      { ...topic, title: before.title },
      '2026-10-08',
      boundary,
    )
    // Same title as the fallback: the objective/summary guard still rejects the old generation.
    expect(
      await repo.updateTitleIfCurrent(
        original.userId,
        original.id,
        before.title,
        'Late title',
        'Late goal',
        before.goal,
      ),
    ).toBe(false)
    expect(await repo.getSession(original.userId, original.id)).toMatchObject({
      ...topic,
      title: before.title,
    })
  })

  test('first user message seeds the objective without an auxiliary model', async () => {
    const row = (content: string, extras = {}): PersistedMessage => ({
      id: content,
      sessionId: original.id,
      userId: original.userId,
      payload: { id: content, role: 'user', content, ...extras },
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    })
    const published: unknown[] = []
    const updated = await bumpSessionForTurn(
      repo,
      (s) => published.push(s),
      original.userId,
      original.id,
      original,
      [
        row('Hidden wake', { isInternal: true }),
        row('Machine notice', { from: 'system' }),
        row('Fix parser while keeping Bun.'),
      ],
      '2026-10-08',
    )
    expect(updated.goal).toBe('Fix parser while keeping Bun.')
    expect(published).toHaveLength(1)
    await repo.updateSessionTopic(
      original.userId,
      original.id,
      updated,
      topic,
      '2026-10-09',
      boundary,
    )
    // Deliberately supply the stale session: a new turn must keep the topic saved in the row.
    const next = await bumpSessionForTurn(
      repo,
      () => {},
      original.userId,
      original.id,
      original,
      [row('Another question')],
      '2026-10-10',
    )
    expect(next).toMatchObject(topic)
  })

  test('a seed cannot overwrite a custom title or an explicit objective', async () => {
    await repo.updateSession(original.userId, original.id, {
      title: 'Chosen name',
      goal: 'Chosen goal',
      previousTopicSummary: 'Prior decisions.',
    })
    await repo.seedSessionTopic(original.userId, original.id, 'Fallback', 'Fallback goal')
    expect(await repo.getSession(original.userId, original.id)).toMatchObject({
      title: 'Chosen name',
      goal: 'Chosen goal',
      previousTopicSummary: 'Prior decisions.',
    })
  })

  test('a missing or foreign boundary author changes neither goal nor history', async () => {
    for (const marker of [
      { ...boundary, messageId: 'missing' },
      { ...boundary, agentId: 'another-agent' },
    ]) {
      expect(
        await repo.updateSessionTopic(
          original.userId,
          original.id,
          original,
          topic,
          '2026-10-08',
          marker,
        ),
      ).toBe(false)
      expect(await repo.getSession(original.userId, original.id)).toMatchObject({
        title: original.title,
        goal: null,
        previousTopicSummary: null,
      })
      expect(
        (await repo.getMessage(original.userId, original.id, boundary.messageId))?.payload
          .contextBoundary,
      ).toBeUndefined()
    }
  })

  test('finishing the streaming reply cannot erase the committed topic boundary', async () => {
    const before = (await repo.getMessage(original.userId, original.id, boundary.messageId))!
    const known = { payload: before.payload, payloadJson: serializeMessagePayload(before.payload) }
    expect(
      await repo.updateSessionTopic(
        original.userId,
        original.id,
        original,
        topic,
        '2026-10-08',
        boundary,
      ),
    ).toBe(true)
    await repo.updateMessage(
      original.userId,
      original.id,
      boundary.messageId,
      { content: 'Final public reply.' },
      '2026-10-09',
      known,
    )
    expect(
      (await repo.getMessage(original.userId, original.id, boundary.messageId))?.payload,
    ).toMatchObject({
      contextBoundary: true,
      content: 'Final public reply.',
    })
  })
})
