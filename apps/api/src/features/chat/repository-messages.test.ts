import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { Kysely } from 'kysely'

import {
  createDatabase,
  deserializeMessagePayload,
  destroyDatabase,
  type AppDatabase,
  type StoredMessagePayload,
} from '../../db'
import { migrateToLatest } from '../../db/migrator'
import type { PersistedMessage } from './contracts'
import { createChatRepository, type ChatRepository, type SessionRecord } from './repository'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { DEFAULT_AGENT_PARTICIPANT } from '../../db'

const tempDir = join(process.cwd(), 'tmp', 'chat-repository-messages-tests')
const userId = 'message-list-user'
const timestamp = '2026-08-04T00:00:00.000Z'

function session(id: string): SessionRecord {
  return sessionFixture({
    id,
    userId,
    seq: 1,
    title: id,
    agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    rootSessionId: id,
  })
}

function message(
  sessionId: string,
  id: string,
  content = id,
  payload?: Partial<StoredMessagePayload>,
): PersistedMessage {
  return {
    id,
    sessionId,
    userId,
    payload: { id, role: 'assistant', from: DEFAULT_AGENT_PARTICIPANT, content, ...payload },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function insert(repo: ChatRepository, sessionId: string, id: string, content = id) {
  await repo.insertMessage(message(sessionId, id, content))
}

/**
 * Frozen copy of listMessages' pre-optimization result algorithm. It deliberately
 * selects and parses every payload before resolving the leaf: that makes it both
 * the correctness oracle and the measured control arm for the optimization.
 */
async function legacyListMessages(
  db: Kysely<AppDatabase>,
  sessionId: string,
): Promise<PersistedMessage[]> {
  const rows = await db
    .selectFrom('agent_messages')
    .selectAll()
    .where('user_id', '=', userId)
    .where('session_id', '=', sessionId)
    .orderBy('sequence', 'asc')
    .execute()
  if (rows.length === 0) return []

  const payloads = new Map(
    rows.map((row) => {
      // The former cold-cache path hashed and length-checked every payload before
      // parsing it. Keep that CPU in the control arm as well as its returned data.
      Bun.hash(row.payload_json)
      void row.payload_json.length
      return [row.id, deserializeMessagePayload(row.payload_json)]
    }),
  )
  const toMessage = (row: (typeof rows)[number]): PersistedMessage => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    payload: payloads.get(row.id) ?? deserializeMessagePayload(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  const sessionRow = await db
    .selectFrom('agent_sessions')
    .select('leaf_id')
    .where('id', '=', sessionId)
    .executeTakeFirst()
  const leaf = sessionRow?.leaf_id ?? null
  if (!leaf) return rows.map(toMessage)
  const byId = new Map(rows.map((row) => [row.id, row]))
  if (!byId.has(leaf)) return rows.map(toMessage)

  const path: typeof rows = []
  const guard = new Set<string>()
  let cursor: string | null = leaf
  while (cursor !== null && !guard.has(cursor)) {
    guard.add(cursor)
    const node = byId.get(cursor)
    if (!node) break
    path.push(node)
    cursor = node.parent_id
  }
  path.reverse()

  const siblingsByParent = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = row.parent_id ?? '__root__'
    const siblings = siblingsByParent.get(key) ?? []
    siblings.push(row)
    siblingsByParent.set(key, siblings)
  }
  return path.map((row) => {
    const result = toMessage(row)
    const siblings = siblingsByParent.get(row.parent_id ?? '__root__') ?? []
    if (siblings.length > 1) {
      const index = siblings.findIndex((sibling) => sibling.id === row.id)
      if (index >= 0) result.branch = { index, count: siblings.length }
    }
    return result
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

describe('repository.listMessages active-branch hydration', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('matches the former full-row implementation over branch edge shapes', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const comparisons: Array<{ shape: string; ids: string[]; equal: boolean }> = []

    const compare = async (shape: string, sessionId: string) => {
      const expected = await legacyListMessages(db, sessionId)
      const actual = await repo.listMessages(userId, sessionId)
      comparisons.push({
        shape,
        ids: actual.map(({ id }) => id),
        equal: JSON.stringify(actual) === JSON.stringify(expected),
      })
      expect(actual).toEqual(expected)
    }

    await repo.insertSession(session('linear'))
    await insert(repo, 'linear', 'linear-1')
    await insert(repo, 'linear', 'linear-2')
    await insert(repo, 'linear', 'linear-3')
    await compare('no branches', 'linear')

    await repo.insertSession(session('switched'))
    await insert(repo, 'switched', 'switch-root')
    await insert(repo, 'switched', 'switch-a', 'first answer')
    await repo.setSessionLeaf('switched', 'switch-root')
    await insert(repo, 'switched', 'switch-b', 'second answer')
    await repo.setSessionLeaf('switched', 'switch-a')
    await compare('leaf just switched', 'switched')

    await repo.insertSession(session('shared'))
    await insert(repo, 'shared', 'shared-root')
    await insert(repo, 'shared', 'shared-ancestor')
    await insert(repo, 'shared', 'shared-path-a')
    await repo.setSessionLeaf('shared', 'shared-ancestor')
    await insert(repo, 'shared', 'shared-path-b')
    await insert(repo, 'shared', 'shared-active-leaf')
    await compare('shared ancestor on multiple ancestry paths', 'shared')

    await repo.insertSession(session('empty'))
    await compare('empty session', 'empty')

    console.info(`[listMessages-equivalence] ${JSON.stringify(comparisons)}`)
    await destroyDatabase(db)
  })

  test('a looping parent chain truncates where the loop closes, once, and says so', async () => {
    // The recursive walk is bounded by the session's row count rather than by a growing
    // `visited` string (the quadratic term this rewrite removed). A corrupted chain therefore
    // re-emits ids up to that cap; the leaf-first dedup keeps the copy nearest the leaf — the
    // same truncation the old guard produced — and warns instead of hiding the corruption.
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session('loop'))
    await insert(repo, 'loop', 'loop-a')
    await insert(repo, 'loop', 'loop-b')
    await insert(repo, 'loop', 'loop-c')
    // Corrupt: the root now claims the leaf as its parent (a → b → c → a …).
    await db
      .updateTable('agent_messages')
      .set({ parent_id: 'loop-c' })
      .where('id', '=', 'loop-a')
      .execute()

    const warnings: string[] = []
    const warn = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    })
    try {
      const rows = await repo.listMessages(userId, 'loop')
      expect(rows.map(({ id }) => id)).toEqual(['loop-a', 'loop-b', 'loop-c'])
      expect(warnings.some((w) => w.includes('parent chain loops'))).toBe(true)
    } finally {
      warn.mockRestore()
    }
    await destroyDatabase(db)
  })

  test('does not hydrate an abandoned payload and retains cached objects across switches', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const sessionId = 'cache-switch'
    await repo.insertSession(session(sessionId))
    await insert(repo, sessionId, 'cache-root')
    await insert(repo, sessionId, 'cache-a')
    const branchA = await repo.listMessages(userId, sessionId)
    const rootPayload = branchA[0]?.payload
    const branchAPayload = branchA[1]?.payload

    await repo.setSessionLeaf(sessionId, 'cache-root')
    await insert(repo, sessionId, 'cache-b')
    await repo.setSessionLeaf(sessionId, 'cache-a')
    const branchAAgain = await repo.listMessages(userId, sessionId)
    expect(branchAAgain[0]?.payload).toBe(rootPayload)
    expect(branchAAgain[1]?.payload).toBe(branchAPayload)

    await db
      .updateTable('agent_messages')
      .set({ payload_json: '{malformed abandoned tool result' })
      .where('id', '=', 'cache-b')
      .execute()
    expect((await repo.listMessages(userId, sessionId)).map(({ id }) => id)).toEqual([
      'cache-root',
      'cache-a',
    ])
    expect(legacyListMessages(db, sessionId)).rejects.toThrow()
    await destroyDatabase(db)
  })

  test('retains a per-repository six-session LRU cache', async () => {
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const repo = createChatRepository(db)
      const initial = new Map<string, StoredMessagePayload>()
      for (let i = 0; i < 7; i++) {
        const id = `lru-${i}`
        await repo.insertSession(session(id))
        await insert(repo, id, `message-${i}`)
        if (i < 6) initial.set(id, (await repo.listMessages(userId, id))[0]!.payload)
      }
      expect((await repo.listMessages(userId, 'lru-0'))[0]!.payload).toBe(initial.get('lru-0')!)
      await repo.listMessages(userId, 'lru-6')
      expect((await repo.listMessages(userId, 'lru-0'))[0]!.payload).toBe(initial.get('lru-0')!)
      expect((await repo.listMessages(userId, 'lru-1'))[0]!.payload).not.toBe(initial.get('lru-1')!)
      expect((await createChatRepository(db).listMessages(userId, 'lru-0'))[0]!.payload).not.toBe(
        initial.get('lru-0')!,
      )
    } finally {
      await destroyDatabase(db)
    }
  })

  test('deletions invalidate only their session cache while empty deletions retain it', async () => {
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const repo = createChatRepository(db)
      for (const id of ['deleting', 'retained']) {
        await repo.insertSession(session(id))
        await insert(repo, id, `${id}-root`)
        await insert(repo, id, `${id}-tail`)
      }
      const deleting = await repo.listMessages(userId, 'deleting')
      const retained = await repo.listMessages(userId, 'retained')
      await repo.deleteMessagesByIds(userId, 'deleting', [])
      expect((await repo.listMessages(userId, 'deleting'))[0]!.payload).toBe(deleting[0]!.payload)
      await repo.deleteMessagesByIds(userId, 'deleting', ['deleting-tail'])
      const after = await repo.listMessages(userId, 'deleting')
      expect(after.map((msg) => msg.id)).toEqual(['deleting-root'])
      expect(after[0]!.payload).toEqual(deleting[0]!.payload)
      expect(after[0]!.payload).not.toBe(deleting[0]!.payload)
      expect((await repo.listMessages(userId, 'retained'))[0]!.payload).toBe(retained[0]!.payload)
    } finally {
      await destroyDatabase(db)
    }
  })

  test('measures discarded payload work on a realistic branched session', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const setupRepo = createChatRepository(db)
    const sessionId = 'measured-tree'
    await setupRepo.insertSession(session(sessionId))

    for (let index = 0; index < 20; index += 1) {
      await insert(setupRepo, sessionId, `common-${index}`)
    }
    const branchPoint = 'common-19'
    const largeResult = 'tool output '.repeat(4_096)
    const insertToolResult = (id: string) =>
      setupRepo.insertMessage(
        message(sessionId, id, '', {
          items: [
            {
              id: `tool-${id}`,
              type: 'tool_call',
              status: 'completed',
              toolCallId: `tool-${id}`,
              name: 'read_large_result',
              activeVerb: 'Reading',
              input: { path: `/workspace/${id}.log` },
              resultText: 'Large result retained for the model',
              output: { text: largeResult },
            },
          ],
        }),
      )

    for (let branch = 0; branch < 4; branch += 1) {
      await setupRepo.setSessionLeaf(sessionId, branchPoint)
      for (let index = 0; index < 30; index += 1) {
        await insertToolResult(`abandoned-${branch}-${index}`)
      }
    }
    await setupRepo.setSessionLeaf(sessionId, branchPoint)
    for (let index = 0; index < 80; index += 1) {
      await insertToolResult(`active-${index}`)
    }

    const stored = await db
      .selectFrom('agent_messages')
      .select(['id', 'payload_json'])
      .where('user_id', '=', userId)
      .where('session_id', '=', sessionId)
      .execute()
    const expected = await legacyListMessages(db, sessionId)
    const activeIds = new Set(expected.map(({ id }) => id))
    const totalBytes = stored.reduce((sum, row) => sum + Buffer.byteLength(row.payload_json), 0)
    const activeBytes = stored.reduce(
      (sum, row) => sum + (activeIds.has(row.id) ? Buffer.byteLength(row.payload_json) : 0),
      0,
    )
    const legacyTimes: number[] = []
    const currentTimes: number[] = []

    // Alternate the control/current arms so cache warmth and host load do not
    // systematically favour either implementation. Each current arm gets a new
    // repository instance, keeping its parse cache cold like the legacy parse.
    for (let sample = 0; sample < 9; sample += 1) {
      const runLegacy = async () => {
        const start = Bun.nanoseconds()
        await legacyListMessages(db, sessionId)
        legacyTimes.push((Bun.nanoseconds() - start) / 1_000_000)
      }
      const runCurrent = async () => {
        const repo = createChatRepository(db)
        const start = Bun.nanoseconds()
        await repo.listMessages(userId, sessionId)
        currentTimes.push((Bun.nanoseconds() - start) / 1_000_000)
      }
      if (sample % 2 === 0) {
        await runLegacy()
        await runCurrent()
      } else {
        await runCurrent()
        await runLegacy()
      }
    }

    const discardedRows = stored.length - expected.length
    const measurement = {
      before: {
        rowsFetched: stored.length,
        rowsDiscarded: discardedRows,
        bytesParsed: totalBytes,
        medianWallMs: Number(median(legacyTimes).toFixed(3)),
      },
      after: {
        rowsFetched: expected.length,
        rowsDiscarded: 0,
        bytesParsed: activeBytes,
        medianWallMs: Number(median(currentTimes).toFixed(3)),
      },
      discardedRowFraction: Number((discardedRows / stored.length).toFixed(4)),
      discardedByteFraction: Number(((totalBytes - activeBytes) / totalBytes).toFixed(4)),
      wallSpeedup: Number((median(legacyTimes) / median(currentTimes)).toFixed(2)),
    }
    console.info(`[listMessages-measurement] ${JSON.stringify(measurement)}`)

    expect(measurement.discardedRowFraction).toBeGreaterThan(0.5)
    expect(measurement.discardedByteFraction).toBeGreaterThan(0.5)
    await destroyDatabase(db)
  }, 30_000)
})
