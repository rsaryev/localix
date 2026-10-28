import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { sessionFixture } from '../../testing/session-fixture'
import { createChatRepository, toSessionSummary } from './repository'
import { bumpSessionForTurn } from './service/message-builders'
import type { PersistedMessage } from './contracts'

describe('shared session topic persistence', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>
  const original = sessionFixture({ title: 'New Chat' })
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
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('legacy sessions read null fields and topic writes round-trip through the read model', async () => {
    const before = (await repo.getSession(original.userId, original.id))!
    expect(before).toMatchObject({ goal: null, previousTopicSummary: null })
    await repo.updateSession(original.userId, original.id, topic)
    const after = (await repo.getSession(original.userId, original.id))!
    expect(after).toMatchObject(topic)
    expect(toSessionSummary(after)).toMatchObject(topic)
    expect(after.agent).toEqual(before.agent)
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
    await repo.updateSession(original.userId, original.id, { ...topic, title: before.title })
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
    const row = (
      content: string,
      extras: Partial<PersistedMessage['payload']> = {},
    ): PersistedMessage => ({
      id: content,
      sessionId: original.id,
      userId: original.userId,
      payload: { id: content, role: 'user', from: 'user', content, ...extras },
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
    await repo.updateSession(original.userId, original.id, topic)
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
})
