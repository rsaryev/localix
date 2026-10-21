import { expect, test } from 'bun:test'

import { createDatabase, DEFAULT_AGENT_PARTICIPANT } from '../../db'
import { migrateToLatest } from '../../db/migrator'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'

const at = '2026-08-04T00:00:00.000Z'

test('a message edit is announced; streaming checkpoints between are not', async () => {
  const db = createDatabase()
  await migrateToLatest(db)
  const repo = createChatRepository(db)
  await repo.insertSession(
    sessionFixture({
      id: 's1',
      userId: 'u1',
      seq: 1,
      title: 's1',
      agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
      createdAt: at,
      updatedAt: at,
      lastMessageAt: at,
      rootSessionId: 's1',
    }),
  )
  await repo.insertMessage({
    id: 'm1',
    sessionId: 's1',
    userId: 'u1',
    payload: { id: 'm1', role: 'assistant', from: DEFAULT_AGENT_PARTICIPANT, content: '' },
    createdAt: at,
    updatedAt: at,
  })
  const count = async () =>
    (
      await db
        .selectFrom('change_events')
        .select('seq')
        .where('entity', '=', 'chat.message')
        .execute()
    ).length
  const inserted = await count()
  const first = await repo.updateMessage('u1', 's1', 'm1', { content: 'He' }, at)
  expect(await count()).toBe(inserted + 1)
  const second = await repo.updateMessage('u1', 's1', 'm1', { content: 'Hello' }, at, first!)
  expect(await count()).toBe(inserted + 1)
  await repo.updateMessage(
    'u1',
    's1',
    'm1',
    { content: 'Hello.', providerMeta: { provider: 'x' } as never },
    at,
    second!,
  )
  expect(await count()).toBe(inserted + 2)
})
