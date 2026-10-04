/**
 * The migration that retires LLM compaction deletes user data, so what it deletes is pinned here:
 * compaction boundaries and their notices go, with the conversation tree stitched back together
 * around them; `/clear` boundaries, ordinary turns and every other setting stay.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { sql, type Kysely } from 'kysely'
import type { MigrationProvider } from 'kysely/migration'

import * as baseline from '../../migrations/20260601T000000_init_schema'
import * as checkpoints from '../../migrations/20260924T180000_context_checkpoints'
import { createDatabase, destroyDatabase } from './connection'
import { BASELINE_MIGRATION } from './migration-provider'
import { migrateToLatest } from './migrator'
import type { AppDatabase } from './types'

const CHECKPOINTS = '20260924T180000_context_checkpoints'
const provider = (withCheckpoints: boolean): MigrationProvider => ({
  getMigrations: async () => ({
    [BASELINE_MIGRATION]: baseline,
    ...(withCheckpoints ? { [CHECKPOINTS]: checkpoints } : {}),
  }),
})

const databases: Kysely<AppDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => destroyDatabase(db)))
})

async function seededLegacyDatabase() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db, { migrations: provider(false) })
  await sql`INSERT INTO agent_sessions (id, project_id, user_id, title) VALUES ('s', 'PRJ-1', 'u', 't')`.execute(
    db,
  )
  const row = async (id: string, sequence: number, parent: string | null, payload: object) =>
    sql`INSERT INTO agent_messages (id, session_id, user_id, sequence, role, parent_id, payload_json)
        VALUES (${id}, 's', 'u', ${sequence}, 'user', ${parent}, ${JSON.stringify(payload)})`.execute(
      db,
    )
  await row('m1', 1, null, { role: 'user', content: 'first' })
  await row('summary', 2, 'm1', { role: 'user', contextSummary: 'old', compactedUpToId: 'm1' })
  await row('notice', 3, 'summary', { role: 'user', systemNotice: { kind: 'context_compacted' } })
  await row('m2', 4, 'notice', { role: 'user', content: 'after' })
  await row('clear', 5, 'm2', { role: 'user', contextBoundary: true, isInternal: true })
  await sql`UPDATE agent_sessions SET leaf_id = 'clear' WHERE id = 's'`.execute(db)
  await sql`INSERT INTO agent_queue_items (id, user_id, session_id, priority, kind, payload_json, delivery_key, queued_at)
      VALUES ('q', 'u', 's', 0, 'compact', '{}', 'k', '2026-01-01')`.execute(db)
  await sql`INSERT INTO user_profiles (user_id, agent_settings) VALUES ('u', ${JSON.stringify({
    disabledTools: ['bash'],
    modelRouting: { compression: { modelId: 'x' }, titleGeneration: { modelId: 'y' } },
  })})`.execute(db)
  return db
}

describe('context checkpoints migration', () => {
  test('removes compaction rows and stitches the tree around them', async () => {
    const db = await seededLegacyDatabase()
    await migrateToLatest(db, { migrations: provider(true) })

    const rows = await sql<{ id: string; parent_id: string | null }>`
      SELECT id, parent_id FROM agent_messages ORDER BY sequence`.execute(db)
    expect(rows.rows).toEqual([
      { id: 'm1', parent_id: null },
      { id: 'm2', parent_id: 'm1' },
      { id: 'clear', parent_id: 'm2' },
    ])
    const queue = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_queue_items`.execute(db)
    expect(queue.rows[0]?.n).toBe(0)
  })

  test('drops only the dead summarizer route from stored settings', async () => {
    const db = await seededLegacyDatabase()
    await migrateToLatest(db, { migrations: provider(true) })

    const profile = await sql<{ agent_settings: string }>`
      SELECT agent_settings FROM user_profiles WHERE user_id = 'u'`.execute(db)
    expect(JSON.parse(profile.rows[0]!.agent_settings)).toEqual({
      disabledTools: ['bash'],
      modelRouting: { titleGeneration: { modelId: 'y' } },
    })
  })

  test('creates the model-context table the checkpoint loader reads', async () => {
    const db = await seededLegacyDatabase()
    await migrateToLatest(db, { migrations: provider(true) })
    const table = await sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE name = 'agent_message_model_context'`.execute(db)
    expect(table.rows).toHaveLength(1)
  })
})
