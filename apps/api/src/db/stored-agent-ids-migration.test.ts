import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261115T000003_drop_stored_agent_ids'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

test('plans, work records, turn starts and queued turns stop naming their agent', async () => {
  const db = createDatabase()
  databases.push(db)
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < BEFORE))
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })

  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id)
    VALUES ('s1', 'u1', 'Chat', 'p1')`.execute(db)
  await sql`INSERT INTO work_records
      (id, user_id, session_id, agent_id, display_id, kind, label, status, tool_call_id, started_at)
    VALUES ('w1', 'u1', 's1', 'builtin:lead', 'bg-1', 'job', 'x', 'running', 'tc', '2026-01-01')`.execute(
    db,
  )
  await sql`INSERT INTO agent_turn_starts (assistant_message_id, user_id, session_id, agent_id, created_at)
    VALUES ('a1', 'u1', 's1', 'builtin:lead', '2026-01-01')`.execute(db)
  await sql`INSERT INTO agent_queue_items
      (id, user_id, session_id, priority, kind, payload_json, delivery_key, queued_at, state)
    VALUES ('q1', 'u1', 's1', 0, 'ticket', ${JSON.stringify({
      agentTurn: {
        agentId: 'builtin:lead',
        assistantMessageId: 'a1',
        scope: { agentId: 'builtin:lead', conversationId: 'c1' },
      },
    })}, 'k1', '2026-01-01', 'pending')`.execute(db)

  await migrateToLatest(db)

  const columns = async (table: string) =>
    (
      await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(db)
    ).rows.map((row) => row.name)
  expect(await columns('session_plans')).not.toContain('author_agent_id')
  expect(await columns('work_records')).not.toContain('agent_id')
  expect(await columns('agent_turn_starts')).not.toContain('agent_id')
  const work = await sql<{ id: string }>`SELECT id FROM work_records`.execute(db)
  expect(work.rows).toEqual([{ id: 'w1' }])
  const queued = await sql<{
    payload_json: string
  }>`SELECT payload_json FROM agent_queue_items`.execute(db)
  expect(JSON.parse(queued.rows[0]!.payload_json)).toEqual({
    agentTurn: { assistantMessageId: 'a1', scope: { conversationId: 'c1' } },
  })
})
