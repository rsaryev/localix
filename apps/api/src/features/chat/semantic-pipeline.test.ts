/**
 * The whole semantic path over a real migrated database: change feed → chat's semantic targets →
 * outbox → indexer → vectors → the hybrid chat providers. The engine is the deterministic fake.
 */
import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import {
  createCoreChangeFeed,
  recordCoreChanges,
  type CoreCascades,
  type CoreRefs,
} from '../changes/core-entities'
import { createIndexer } from '../embeddings/indexer'
import { removeKeys } from '../embeddings/ingest'
import { semanticHandlers } from '../embeddings/targets'
import { createSemanticVectors } from '../embeddings/semantic-vectors'
import { createSemanticReader } from '../embeddings/semantic-index'
import { createSemanticStore } from '../embeddings/store'
import { createFakeEngine, FAKE_DIMENSIONS } from '../embeddings/testing/fake-engine'
import { createVectorCache } from '../embeddings/vector-cache'
import { createMessageSearchReads } from './message-search-reads'
import {
  chatSemanticTargets,
  createMessagesSemanticSource,
  createSessionsSemanticSource,
} from './semantic-sources'
import { createMessagesSearchProvider, createSessionsSearchProvider } from './search-provider'

type Db = ReturnType<typeof createDatabase>
let seq = 0

async function addSession(db: Db, id: string, title: string, project = 'p1') {
  await db
    .insertInto('agent_sessions')
    .values({ id, user_id: 'u1', title, project_id: project })
    .execute()
}

async function addMessage(
  db: Db,
  id: string,
  session: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  await db
    .insertInto('agent_messages')
    .values({
      id,
      session_id: session,
      user_id: 'u1',
      sequence: ++seq,
      role: 'user',
      payload_json: JSON.stringify({ role: 'user', content, ...extra }),
    })
    .execute()
}

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const store = createSemanticStore(db)
  const cache = createVectorCache(store, () => FAKE_DIMENSIONS)
  const engine = createFakeEngine()
  const sources = [createMessagesSemanticSource(db), createSessionsSemanticSource(db)]
  const indexer = createIndexer({ store, cache, sources: () => sources })
  const vectors = createSemanticVectors({
    strategy: () => ({ mode: 'hybrid' }),
    engine: () => engine,
  })
  const reader = createSemanticReader({ store, cache, vectors })
  const run = async () => {
    indexer.kick()
    await indexer.idle()
    await indexer.idle()
  }
  return { db, store, cache, indexer, engine, reader, run }
}

async function seed(db: Db) {
  await addSession(db, 's-hooks', 'Webhook delivery')
  await addSession(db, 's-fonts', 'Landing page')
  await addMessage(
    db,
    'm-retry',
    's-hooks',
    'We configured redelivery with exponential backoff for failed callbacks.',
  )
  await addMessage(db, 'm-font', 's-fonts', 'Switched the hero typography to a geometric typeface.')
  await addMessage(db, 'm-wake', 's-hooks', 'internal retry wake prompt', { isInternal: true })
  for (let i = 0; i < 30; i++)
    await addMessage(db, `m-noise-${i}`, 's-fonts', `lunch and weather chat number ${i}`)
}

describe('semantic pipeline over chat', () => {
  test('a row written without a change notice reaches nothing', async () => {
    const { db, store } = await setup()
    await addSession(db, 's1', 'x')
    await addMessage(db, 'm1', 's1', 'hello')
    expect(await store.outboxSize()).toBe(0)
  })

  test('reconcile indexes visible messages and titles, never hidden rows', async () => {
    const { db, store, indexer, engine, run } = await setup()
    await seed(db)
    indexer.start(engine)
    await run()
    const counts = await store.counts()
    expect(counts.get('chat.messages')!.items).toBe(32)
    expect(counts.get('chat.sessions')!.items).toBe(2)
    expect(await store.keysOf('chat.messages')).not.toContain('m-wake')
  })

  test('chat changes on the feed reach the index; a chat deletion takes its messages', async () => {
    const { db, store, cache, indexer, engine, run } = await setup()
    await seed(db)
    indexer.start(engine)
    await run()
    const feed = createCoreChangeFeed(db)
    await feed.subscribe(
      'semantic-index',
      semanticHandlers<CoreRefs, CoreCascades>(
        {
          ...chatSemanticTargets(db),
          skill: 'ignore',
          plugin: 'ignore',
          mcp: 'ignore',
          agent: 'ignore',
          project: 'ignore',
          'capability.rule': 'ignore',
          'provider.connection': 'ignore',
        },
        {
          changed: (collection, keys) => store.enqueue(collection, keys),
          resync: async () => {},
          removeUnder: async (collection, parent) => {
            await removeKeys(
              { store, cache },
              collection,
              await store.keysUnder(collection, parent),
            )
          },
        },
      ),
      { kind: 'projector' },
    )
    await addMessage(db, 'm-new', 's-hooks', 'docker compose fails on the container port')
    await recordCoreChanges(db, {
      entity: 'chat.message',
      op: 'upserted',
      ref: { id: 'm-new', userId: 'u1', sessionId: 's-hooks' },
    })
    await feed.settle()
    expect(await store.outboxSize()).toBeGreaterThan(0)
    await run()
    expect(await store.keysOf('chat.messages')).toContain('m-new')
    // The chat goes, and its messages with it: one notice, no key per message.
    await db.deleteFrom('agent_messages').where('session_id', '=', 's-hooks').execute()
    await db.deleteFrom('agent_sessions').where('id', '=', 's-hooks').execute()
    await recordCoreChanges(db, {
      entity: 'chat.session',
      op: 'deleted',
      ref: { id: 's-hooks', userId: 'u1' },
    })
    await feed.settle()
    await run()
    const keys = await store.keysOf('chat.messages')
    expect(keys).not.toContain('m-new')
    expect(keys).not.toContain('m-retry')
    expect(await store.keysOf('chat.sessions')).toEqual(['s-fonts'])
    await feed.close()
  })

  test('the hybrid providers find by meaning and say so; nonsense finds nothing', async () => {
    const { db, indexer, engine, reader, run } = await setup()
    await seed(db)
    indexer.start(engine)
    await run()
    const reads = createMessageSearchReads(db)
    const sessions = [
      {
        id: 's-hooks',
        title: 'Webhook delivery',
        projectId: 'p1',
        parentSessionId: null,
        sessionKind: 'chat',
      },
      {
        id: 's-fonts',
        title: 'Landing page',
        projectId: 'p1',
        parentSessionId: null,
        sessionKind: 'chat',
      },
    ]
    const port = {
      listSessions: async () => sessions,
      searchMessages: async () => [],
      hybridReads: reads,
    }
    const messages = createMessagesSearchProvider(port)
    const search = (text: string) =>
      messages.search('u1', { text, projectId: 'p1', semantic: reader.queryFor('u1', text)! })
    const byMeaning = (await search('reintento webhook')) as Array<{
      id: string
      matchedBy?: string
    }>
    expect(byMeaning[0]!.id).toContain('m-retry')
    expect(byMeaning[0]!.matchedBy).toBe('meaning')
    expect(await search('zxqv plorb')).toEqual([])

    const titles = createSessionsSearchProvider(port)
    const hits = (await titles.search('u1', {
      text: 'callback',
      projectId: 'p1',
      semantic: reader.queryFor('u1', 'callback')!,
    })) as Array<{ title: string }>
    expect(hits.map((h) => h.title)).toEqual(['Webhook delivery'])
  })

  test('a new vector space (source version) rebuilds the collection', async () => {
    const { db, store, indexer, engine, run } = await setup()
    await seed(db)
    indexer.start(engine)
    await run()
    const state = (await store.readCollection('chat.sessions'))!
    await store.writeCollection({ ...state, fingerprint: 'old-model#v1' })
    await run()
    expect((await store.readCollection('chat.sessions'))!.fingerprint).not.toBe('old-model#v1')
    expect((await store.counts()).get('chat.sessions')!.items).toBe(2)
  })

  test('a failing engine keeps changes queued and reports the error', async () => {
    const { db, store, run } = await setup()
    let failing = true
    const engine = createFakeEngine({ fail: () => failing })
    const cache = createVectorCache(store, () => FAKE_DIMENSIONS)
    const indexer = createIndexer({
      store,
      cache,
      sources: () => [createMessagesSemanticSource(db)],
    })
    await addSession(db, 's1', 't')
    await addMessage(db, 'm1', 's1', 'payment declined')
    indexer.start(engine)
    indexer.kick()
    await indexer.idle()
    expect(indexer.progress()).toMatchObject({
      phase: 'retrying',
      lastError: 'fake engine failure',
    })
    failing = false
    indexer.kick()
    await indexer.idle()
    expect(await store.keysOf('chat.messages')).toEqual(['m1'])
    void run
    await indexer.stop()
  })
})
