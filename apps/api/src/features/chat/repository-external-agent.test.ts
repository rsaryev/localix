import { expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository } from './repository'
import { toSessionSummary } from './repository-mappers'
import { sessionFixture } from '../../testing/session-fixture'

test('external agent choice and native identity survive repository reload alongside ordinary chat data', async () => {
  const db = createDatabase()
  try {
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const record = sessionFixture({
      id: 'LOCALIX-1',
      seq: 1,
      userId: 'user',
      externalAgentProvider: 'codex',
      projectId: 'default',
    })
    await repo.insertSession(record)
    await repo.updateSession('user', record.id, { externalAgentSessionKey: 'codex:native' })
    const restored = (await createChatRepository(db).listSessions('user'))[0]!
    expect(restored).toMatchObject({
      id: record.id,
      projectId: 'default',
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    })
    expect(toSessionSummary(restored)).toMatchObject({
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    })
    await repo.updateSession('other-user', record.id, { externalAgentSessionKey: 'codex:foreign' })
    expect((await repo.listSessions('user'))[0]?.externalAgentSessionKey).toBe('codex:native')
  } finally {
    await destroyDatabase(db)
  }
})
