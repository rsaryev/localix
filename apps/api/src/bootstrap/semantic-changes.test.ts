import { afterEach, describe, expect, test } from 'bun:test'
import type { Kysely } from 'kysely'
import { createDatabase } from '../db/connection'
import { migrateToLatest } from '../db/migrator'
import type { AppDatabase } from '../db/types'
import { createCoreChangeFeed, recordCoreChanges } from '../features/changes/core-entities'
import {
  createMessagesSemanticSource,
  createSessionsSemanticSource,
  MESSAGES_COLLECTION,
  SESSIONS_COLLECTION,
} from '../features/chat/repository-semantic-sources'
import type { SemanticServiceDeps } from '../features/embeddings/service'
import { createSemanticService } from '../features/embeddings/service'
import { createSemanticStore } from '../features/embeddings/store'
import { FAKE_MODEL, fakeVector } from '../features/embeddings/testing/fake-engine'
import { subscribeSemanticToChanges } from './semantic-changes'

/** The embedding model is installed and stays so: downloads are not what these tests are about. */
const installedModels: SemanticServiceDeps['localModels'] = {
  isInstalled: () => true,
  background: { reconcile: () => {} } as never,
  job: () => null,
  router: {} as never,
  status: async () => ({
    runtime: { supported: true, tag: 'b1', installed: true },
    machine: null,
    installed: [],
    jobs: [],
    paused: [],
    running: [],
    diskBytes: 0,
  }),
  subscribe: () => () => {},
}

let closeAll: (() => Promise<void>) | undefined
afterEach(async () => {
  await closeAll?.()
  closeAll = undefined
})

async function setup(seed: (db: Kysely<AppDatabase>) => Promise<void>) {
  const db = createDatabase()
  await migrateToLatest(db)
  await seed(db)
  let embedded = 0
  const service = createSemanticService({
    store: createSemanticStore(db),
    localModels: installedModels,
    model: FAKE_MODEL,
    backend: () => ({
      running: true,
      embed: async (inputs) => {
        embedded += inputs.length
        return inputs.map((input) => [...fakeVector(input)])
      },
      stop: async () => {},
    }),
  })
  service.registerSource(createMessagesSemanticSource(db))
  service.registerSource(createSessionsSemanticSource(db))
  await service.boot()
  const feed = createCoreChangeFeed(db)
  await subscribeSemanticToChanges({ db, feed, semantic: service })
  closeAll = async () => {
    await feed.close()
    await service.shutdown()
  }
  const store = createSemanticStore(db)
  const keys = async (collection: string) => (await store.keysOf(collection)).sort()
  const settle = async () => {
    await feed.settle()
    for (let i = 0; i < 3; i++) await service.settle()
  }
  await settle()
  return {
    db,
    service,
    settle,
    embedded: () => embedded,
    keys,
  }
}

function session(db: Kysely<AppDatabase>, id: string, title: string) {
  return db
    .insertInto('agent_sessions')
    .values({ id, user_id: 'u1', title, project_id: 'p1' })
    .execute()
}

function message(db: Kysely<AppDatabase>, id: string, sessionId: string, content: string) {
  return db
    .insertInto('agent_messages')
    .values({
      id,
      session_id: sessionId,
      user_id: 'u1',
      sequence: Number(id.slice(1)),
      role: 'user',
      payload_json: JSON.stringify({ content }),
    })
    .execute()
}

const messageRef = (id: string, sessionId: string) => ({ id, userId: 'u1', sessionId })

describe('semantic index on the core change feed', () => {
  test('a message notice makes it searchable; a repeated notice embeds nothing again', async () => {
    const t = await setup((db) => session(db, 's1', 'Billing'))
    await message(t.db, 'm1', 's1', 'payment declined')
    const notice = { entity: 'chat.message', op: 'upserted', ref: messageRef('m1', 's1') } as const
    await recordCoreChanges(t.db, [notice, notice])
    await t.settle()

    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m1'])
    const [match] = await t.service.reader.query('u1', MESSAGES_COLLECTION, 'card payment')
    expect(match?.key).toBe('m1')
    const embedded = t.embedded()

    await recordCoreChanges(t.db, notice)
    await t.settle()
    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m1'])
    expect(t.embedded()).toBe(embedded)
  })

  test('a resync notice reconciles the collection with what the owner holds', async () => {
    const t = await setup(async (db) => {
      await session(db, 's1', 'Billing')
      await message(db, 'm1', 's1', 'payment declined')
    })
    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m1'])

    // Written and removed with no notice: only a reconcile can see either.
    await message(t.db, 'm2', 's1', 'refund the order')
    await t.db.deleteFrom('agent_messages').where('id', '=', 'm1').execute()
    await recordCoreChanges(t.db, { entity: 'chat.message', op: 'resync' })
    await t.settle()

    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m2'])
  })

  test('deleting a chat takes its title and messages out of the index, once or twice', async () => {
    const t = await setup(async (db) => {
      await session(db, 's1', 'Billing')
      await message(db, 'm1', 's1', 'payment declined')
      await message(db, 'm2', 's1', 'refund the order')
      await session(db, 's2', 'Travel')
      await message(db, 'm3', 's2', 'book a flight')
    })
    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m1', 'm2', 'm3'])
    expect(await t.keys(SESSIONS_COLLECTION)).toEqual(['s1', 's2'])

    await t.db.deleteFrom('agent_messages').where('session_id', '=', 's1').execute()
    await t.db.deleteFrom('agent_sessions').where('id', '=', 's1').execute()
    const deleted = {
      entity: 'chat.session',
      op: 'deleted',
      ref: { id: 's1', userId: 'u1' },
    } as const
    await recordCoreChanges(t.db, deleted)
    await t.settle()

    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m3'])
    expect(await t.keys(SESSIONS_COLLECTION)).toEqual(['s2'])
    expect(
      await t.service.reader.query('u1', MESSAGES_COLLECTION, 'card payment'),
    ).not.toContainEqual(expect.objectContaining({ key: 'm1' }))

    await recordCoreChanges(t.db, deleted)
    await t.settle()
    expect(await t.keys(MESSAGES_COLLECTION)).toEqual(['m3'])
    expect(await t.keys(SESSIONS_COLLECTION)).toEqual(['s2'])
  })
})
