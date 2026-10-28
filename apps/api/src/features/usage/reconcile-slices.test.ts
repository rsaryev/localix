import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_AUTHOR } from '../../db'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { serializeMessagePayload } from '../../db/payload'
import type { AgentMessageRole } from '../../db/types'
import { nextPageSize, reconcileUsageInSlices } from './reconcile-slices'
import { createUsageRepository } from './repository'

const tempDir = join(tmpdir(), `localix-usage-reconcile-slices-tests-${process.pid}`)

describe('nextPageSize', () => {
  test('grows while pages are cheap, shrinks when one overruns, holds near the target', () => {
    expect(nextPageSize(32, 1, 8)).toBe(64)
    // An overrun scales the page to what would have fit: 32 rows in 20 ms → 12 rows in 8.
    expect(nextPageSize(32, 20, 8)).toBe(12)
    expect(nextPageSize(32, 8, 8)).toBe(32)
  })

  test('stays inside its bounds: one row at least, never unbounded', () => {
    expect(nextPageSize(8, 100, 8)).toBe(1)
    expect(nextPageSize(1, 100, 8)).toBe(1)
    expect(nextPageSize(2_048, 0, 8)).toBe(2_048)
  })
})

describe('reconcileUsageInSlices', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  async function seeded(count: number) {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    await db
      .insertInto('agent_sessions')
      .values({ id: 's1', user_id: 'u1', project_id: 'PRJ-test', title: 'Usage' })
      .execute()
    // Every assistant message carries usage and none has a ledger row: all are crash residue.
    const rows = Array.from({ length: count }, (_, i) => {
      const id = `m-${String(i).padStart(3, '0')}`
      return {
        id,
        session_id: 's1',
        user_id: 'u1',
        sequence: i,
        role: (i % 4 === 3 ? 'user' : 'assistant') as AgentMessageRole,
        payload_json: serializeMessagePayload({
          id,
          role: 'assistant',
          from: DEFAULT_AGENT_AUTHOR,
          usage: { inputTokens: i, outputTokens: 1 },
        }),
      }
    })
    await db.insertInto('agent_messages').values(rows).execute()
    const assistants = rows.filter((row) => row.role === 'assistant').length
    return { db, assistants }
  }

  // The whole-table scan was one synchronous statement; the paged one must still reach every
  // row — a page that skipped or repeated one would under- or double-repair.
  test('pages through every assistant message exactly once, yielding between pages', async () => {
    const { db, assistants } = await seeded(120)
    try {
      let yields = 0
      let clock = 0
      const result = await reconcileUsageInSlices(createUsageRepository(db), {
        yield: async () => {
          yields += 1
        },
        // Every page "overruns" its budget, so the page size halves down to its floor.
        now: () => (clock += 10),
        targetMs: 4,
      })
      expect(result.repaired).toBe(assistants)
      expect(result.pages).toBeGreaterThan(5)
      expect(yields).toBe(result.pages - 1)
      const ledger = await db.selectFrom('usage_events').select('message_id').execute()
      expect(ledger).toHaveLength(assistants)
      // A second pass finds nothing left to repair.
      const again = await reconcileUsageInSlices(createUsageRepository(db), {
        yield: async () => {},
      })
      expect(again.repaired).toBe(0)
      expect(await createUsageRepository(db).reconcileAssistantMessageEvents()).toBe(0)
    } finally {
      await destroyDatabase(db)
    }
  })

  test('a page bounds the rows it SCANS, not the rows it matches', async () => {
    const { db } = await seeded(12)
    try {
      const repo = createUsageRepository(db)
      const first = await repo.reconcileAssistantMessagePage({ afterId: null, limit: 2 })
      expect(first).toEqual({ repaired: 2, lastId: 'm-001' })
      // Nothing left to repair in the next window, and the cursor still advances past it.
      await repo.reconcileAssistantMessagePage({ afterId: first.lastId, limit: 3 })
      const repeat = await repo.reconcileAssistantMessagePage({ afterId: first.lastId, limit: 3 })
      expect(repeat).toEqual({ repaired: 0, lastId: 'm-005' })
      const end = await repo.reconcileAssistantMessagePage({ afterId: 'm-999', limit: 3 })
      expect(end).toEqual({ repaired: 0, lastId: null })
      // A byte budget smaller than any payload still advances, one row at a time.
      const tiny = await repo.reconcileAssistantMessagePage({
        afterId: 'm-005',
        limit: 3,
        maxBytes: 1,
      })
      expect(tiny).toEqual({ repaired: 1, lastId: 'm-006' })
    } finally {
      await destroyDatabase(db)
    }
  })

  test('stops at an abort', async () => {
    const { db } = await seeded(40)
    try {
      const controller = new AbortController()
      const result = await reconcileUsageInSlices(createUsageRepository(db), {
        signal: controller.signal,
        yield: async () => controller.abort(),
      })
      expect(result.pages).toBe(1)
    } finally {
      await destroyDatabase(db)
    }
  })
})
