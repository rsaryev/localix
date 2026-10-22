import { afterEach, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChannelBindingRepository } from './channel-binding-repository'

const dbs: Array<ReturnType<typeof createDatabase>> = []
afterEach(async () => void (await Promise.all(dbs.splice(0).map((db) => db.destroy()))))

async function fixture() {
  const db = createDatabase()
  dbs.push(db)
  await migrateToLatest(db)
  for (const id of ['chat-a', 'chat-b'])
    await db
      .insertInto('agent_sessions')
      .values({
        project_id: 'PRJ-test',
        id,
        user_id: 'u1',
        title: id,
        session_kind: 'chat',
        runtime_status: 'idle',
      })
      .execute()
  return { db, store: createChannelBindingRepository(db) }
}

const binding = (sessionId: string) => ({
  userId: 'u1',
  serverId: 'plugin:fakechat:fakechat',
  cwd: '/repo',
  projectId: 'PRJ-test',
  scope: 'u1:PRJ-test:/repo',
  sessionId,
})

describe('kept channel bindings', () => {
  test('one row per server and directory: the chat that bound it last', async () => {
    const { store } = await fixture()
    await store.save(binding('chat-a'), '2026-10-01T00:00:00.000Z')
    await store.save(binding('chat-b'), '2026-10-01T00:01:00.000Z')
    expect(await store.list()).toEqual([binding('chat-b')])
    await store.remove(binding('chat-b'))
    expect(await store.list()).toEqual([])
  })

  test('a deleted chat takes its bindings with it', async () => {
    const { db, store } = await fixture()
    await store.save(binding('chat-a'), '2026-10-01T00:00:00.000Z')
    await db.deleteFrom('agent_sessions').where('id', '=', 'chat-a').execute()
    expect(await store.list()).toEqual([])
  })
})
