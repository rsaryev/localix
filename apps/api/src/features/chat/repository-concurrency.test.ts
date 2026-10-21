import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'
/// <reference types="bun" />

/**
 * IDEMPOTENCY / RE-ENTRANCY guard for `repository.updateMessage`.
 *
 * A single assistant message row is written by MORE THAN ONE flow at a time:
 *   - the child-session stream flush (content + items) — `runtime/child-sessions.ts`
 *   - the inline-review stamp (`review`) — `service/review-ops.ts`
 *   - finalize / session-status writes
 *
 * `updateMessage` takes a PATCH and folds it into the stored row INSIDE ONE DB
 * transaction (read-merge-write). That transaction is the OWNER of the row (Release
 * It!: a resource touched by two flows needs an owner). This test drives two
 * concurrent writers against the REAL repository + real bun:sqlite — the review-ops
 * unit test only exercises a FAKE `updateMessage`, and a fake built from the merge
 * contract certifies the contract, not that the real transaction survives concurrent
 * writers ("fakes agree with broken code").
 *
 * The property this pins: a writer that patches a DISJOINT field must not clobber a
 * concurrent writer's field. If `updateMessage` ever regresses to a NON-transactional
 * read-then-write (select, await, update-whole-payload), the two SELECTs interleave at
 * the await, each merges onto its own stale read, and one field is lost — this test
 * reddens.
 */

import { createChatFeaturePorts } from '../../bootstrap/chat-feature-ports'
import { serializeMessagePayload } from '../../db/payload'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testWork } from '../../testing/work-fixture'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsService } from '../provider-connections/service'
import type { PersistedMessage } from './contracts'
import { createChatRepository } from './repository'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from './test-harness'

const tempDir = join(process.cwd(), 'tmp', 'chat-repo-concurrency-tests')

async function externalServices() {
  const filename = join(tempDir, `${randomUUID()}.sqlite`)
  const firstDb = createDatabase({ filename })
  await migrateToLatest(firstDb)
  const userId = 'u_external_concurrency'
  await firstDb
    .insertInto('provider_connections')
    .values({
      id: 'pc_external',
      user_id: userId,
      provider_id: 'test-provider',
      provider_name: 'Test Provider',
      label: 'Primary',
      auth_type: 'api-key',
      status: 'active',
    })
    .execute()
  const first = createChatService({
    db: firstDb,
    work: testWork(firstDb),
    ports: createChatFeaturePorts(firstDb),
    catalogService: createCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db: firstDb }),
  })
  await first.createSession(userId, {
    title: 'Provider source',
    providerConnectionId: 'pc_external',
    modelId: 'test-model',
  })

  // A separate sqlite handle models two API processes sharing the same WAL file.
  const secondDb = createDatabase({ filename })
  // Bun's synchronous sqlite call would otherwise block this test's single event
  // loop for the production 5s busy timeout, preventing the winning promise from
  // reaching COMMIT. A short timeout exercises the real retry path instead.
  await Promise.all([
    sql`PRAGMA busy_timeout = 50`.execute(firstDb),
    sql`PRAGMA busy_timeout = 50`.execute(secondDb),
  ])
  const second = createChatService({
    db: secondDb,
    work: testWork(secondDb),
    ports: createChatFeaturePorts(secondDb),
    catalogService: createCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db: secondDb }),
  })
  return { firstDb, secondDb, first, second, userId }
}

async function seededRow() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const chatService = createChatService({
    db,
    work: testWork(db),
    ports: createChatFeaturePorts(db),
    catalogService: createCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  const repo = createChatRepository(db)
  const userId = 'u_concurrency'
  const session = await chatService.createSession(userId, { title: 't' })
  const id = 'msg_race'
  const ts = new Date().toISOString()
  const msg: PersistedMessage = {
    id,
    sessionId: session.id,
    userId,
    payload: { id, role: 'assistant', from: DEFAULT_AGENT_PARTICIPANT, content: 'seed' },
    createdAt: ts,
    updatedAt: ts,
  }
  await repo.insertMessage(msg)
  return { repo, userId, sessionId: session.id, id }
}

beforeAll(async () => {
  await mkdir(tempDir, { recursive: true })
})
afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('repository.insertMessages — atomic turn preamble', () => {
  test('rolls back the user row and leaf when the assistant insert fails', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const chatService = createChatService({
      db,
      work: testWork(db),
      ports: createChatFeaturePorts(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'u_atomic'
    const session = await chatService.createSession(userId, { title: 'atomic' })
    const ts = new Date().toISOString()
    const message = (id: string, role: 'user' | 'assistant'): PersistedMessage => ({
      id,
      sessionId: session.id,
      userId,
      payload: {
        id,
        role,
        from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
        content: role === 'user' ? 'go' : '',
      },
      createdAt: ts,
      updatedAt: ts,
    })

    // Duplicate ids force the second insert to fail after the first has executed.
    await Promise.resolve(
      expect(
        repo.insertMessages([message('same', 'user'), message('same', 'assistant')]),
      ).rejects.toThrow(),
    )
    expect(await repo.listMessages(userId, session.id)).toEqual([])
  })
})

describe('external session identity — concurrent processes', () => {
  test('two resolves of the same external key converge on one chat', async () => {
    const { firstDb, secondDb, first, second, userId } = await externalServices()
    try {
      const key = 'channel:test:room:one'
      await first.createSession(userId, {
        title: 'Unrelated system session',
        sessionKind: 'system',
        sourceToolCallId: key,
      })
      const results = await Promise.all([
        first.resolveExternalSession(userId, { key, title: 'First' }),
        second.resolveExternalSession(userId, { key, title: 'Second' }),
      ])

      expect(new Set(results.map(({ session }) => session.id)).size).toBe(1)
      expect(results.filter(({ created }) => created)).toHaveLength(1)
      const keyed = (await createChatRepository(firstDb).listSessions(userId)).filter(
        (session) => session.sourceToolCallId === key,
      )
      expect(keyed.filter(({ sessionKind }) => sessionKind === 'chat')).toHaveLength(1)
      expect(keyed.filter(({ sessionKind }) => sessionKind === 'system')).toHaveLength(1)
    } finally {
      await Promise.all([destroyDatabase(firstDb), destroyDatabase(secondDb)])
    }
  })

  test('different external keys allocate distinct monotonic LOCALIX refs', async () => {
    const { firstDb, secondDb, first, second, userId } = await externalServices()
    try {
      const results = await Promise.all([
        first.resolveExternalSession(userId, { key: 'channel:test:room:a', title: 'A' }),
        second.resolveExternalSession(userId, { key: 'channel:test:room:b', title: 'B' }),
      ])

      expect(results.every(({ created }) => created)).toBe(true)
      expect(results.map(({ session }) => session.id).sort()).toEqual(['LOCALIX-2', 'LOCALIX-3'])
      expect(results.map(({ session }) => session.seq ?? 0).sort((a, b) => a - b)).toEqual([2, 3])
    } finally {
      await Promise.all([destroyDatabase(firstDb), destroyDatabase(secondDb)])
    }
  })
})

describe('session ref allocation — concurrent processes', () => {
  test('stays globally unique across user ids', async () => {
    const filename = join(tempDir, `${randomUUID()}.sqlite`)
    const firstDb = createDatabase({ filename })
    await migrateToLatest(firstDb)
    const userId = 'u_seq_concurrency'
    const secondDb = createDatabase({ filename })
    await Promise.all([
      sql`PRAGMA busy_timeout = 50`.execute(firstDb),
      sql`PRAGMA busy_timeout = 50`.execute(secondDb),
    ])
    try {
      const refs = await Promise.all([
        createChatRepository(firstDb).allocateSessionRef(userId),
        createChatRepository(secondDb).allocateSessionRef(`${userId}_other`),
      ])
      expect(refs.map(({ seq }) => seq).sort((a, b) => a - b)).toEqual([1, 2])
      expect(refs.map(({ id }) => id).sort()).toEqual(['LOCALIX-1', 'LOCALIX-2'])
    } finally {
      await Promise.all([destroyDatabase(firstDb), destroyDatabase(secondDb)])
    }
  })
})

describe('repository.listMessages — cross-run parse cache coherence', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('an unchanged row reuses the SAME parsed payload object; any write re-parses', async () => {
    const { repo, userId, sessionId, id } = await seededRow()

    const first = (await repo.listMessages(userId, sessionId)).find((m) => m.id === id)
    const second = (await repo.listMessages(userId, sessionId)).find((m) => m.id === id)
    // Identity reuse is the point of the cache (it also makes downstream
    // object-identity memos effective across runs).
    expect(second?.payload).toBe(first!.payload)

    // A repo write changes the stored JSON → the cache must miss into a re-parse.
    await repo.updateMessage(
      userId,
      sessionId,
      id,
      { content: 'CHANGED' },
      new Date().toISOString(),
    )
    const third = (await repo.listMessages(userId, sessionId)).find((m) => m.id === id)
    expect(third?.payload).not.toBe(first!.payload)
    expect(third?.payload.content).toBe('CHANGED')
  })

  test('a DIRECT out-of-band payload write is picked up, never served stale', async () => {
    // A writer that updates payload_json without going through updateMessage — the
    // gallery service used to be one — is a cache miss BY CONSTRUCTION: the cache
    // keys on the stored JSON's hash+length. Kept without a live offender because
    // it pins the property, not the caller.
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const chatService = createChatService({
      db,
      work: testWork(db),
      ports: createChatFeaturePorts(db),
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const repo = createChatRepository(db)
    const userId = 'u_oob'
    const session = await chatService.createSession(userId, { title: 't' })
    const id = 'msg_oob'
    const ts = new Date().toISOString()
    await repo.insertMessage({
      id,
      sessionId: session.id,
      userId,
      payload: { id, role: 'assistant', from: DEFAULT_AGENT_PARTICIPANT, content: 'seed' },
      createdAt: ts,
      updatedAt: ts,
    })

    const before = (await repo.listMessages(userId, session.id)).find((m) => m.id === id)
    expect(before?.payload.content).toBe('seed')

    await db
      .updateTable('agent_messages')
      // Out of band, but still through the codec — the shape any such writer must use.
      .set({
        payload_json: serializeMessagePayload({
          id,
          role: 'assistant',
          from: DEFAULT_AGENT_PARTICIPANT,
          content: 'foreign',
        }),
      })
      .where('id', '=', id)
      .execute()

    const after = (await repo.listMessages(userId, session.id)).find((m) => m.id === id)
    expect(after?.payload.content).toBe('foreign')
    expect(after?.payload).not.toBe(before!.payload)
  })
})
