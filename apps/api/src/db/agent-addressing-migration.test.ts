import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261115T000002_drop_agent_addressing'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

test('stored wakes and delegations no longer say which agent they are for', async () => {
  const db = createDatabase()
  databases.push(db)
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < BEFORE))
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })

  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, invocation_json)
    VALUES ('child', 'u1', 'Child', 'p1', ${JSON.stringify({
      kind: 'task-delegation',
      parentSessionId: 'root',
      toolCallId: 'c1',
      parentAgentId: 'builtin:lead',
    })}),
    ('fork', 'u1', 'Fork', 'p1', ${JSON.stringify({
      kind: 'skill-fork',
      parentSessionId: 'root',
      parentAgentId: 'builtin:lead',
    })})`.execute(db)
  await sql`INSERT INTO agent_queue_items
      (id, user_id, session_id, priority, kind, payload_json, delivery_key, queued_at, state)
    VALUES ('q1', 'u1', 'child', 0, 'report', ${JSON.stringify({
      content: 'x',
      to: { agentId: 'builtin:lead' },
    })}, 'k1', '2026-01-01', 'pending')`.execute(db)
  await sql`INSERT INTO wake_outbox (delivery_key, user_id, session_id, request_json, created_at)
    VALUES ('o1', 'u1', 'child', ${JSON.stringify({
      content: 'y',
      to: { agentId: 'builtin:lead' },
    })}, '2026-01-01')`.execute(db)

  await migrateToLatest(db)

  const one = async (query: ReturnType<typeof sql<{ value: string }>>) =>
    JSON.parse((await query.execute(db)).rows[0]!.value)
  expect(
    await one(
      sql<{
        value: string
      }>`SELECT invocation_json AS value FROM agent_sessions WHERE id = 'child'`,
    ),
  ).toEqual({ kind: 'task-delegation', parentSessionId: 'root', toolCallId: 'c1' })
  expect(
    await one(
      sql<{ value: string }>`SELECT invocation_json AS value FROM agent_sessions WHERE id = 'fork'`,
    ),
  ).toEqual({ kind: 'skill-fork', parentSessionId: 'root' })
  expect(
    await one(sql<{ value: string }>`SELECT payload_json AS value FROM agent_queue_items`),
  ).toEqual({ content: 'x' })
  expect(await one(sql<{ value: string }>`SELECT request_json AS value FROM wake_outbox`)).toEqual({
    content: 'y',
  })
})
