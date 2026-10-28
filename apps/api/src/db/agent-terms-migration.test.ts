import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261115T000000_agent_terms'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

/** Rows written before the vocabulary moved to agents read as the code reads them now. */
test('stored rows drop the group-chat vocabulary and the agent addressing', async () => {
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
      parentParticipant: 'agent:builtin:lead',
    })})`.execute(db)
  await sql`INSERT INTO agent_queue_items
      (id, user_id, session_id, priority, kind, payload_json, delivery_key, queued_at, state)
    VALUES ('q1', 'u1', 'child', 0, 'report', ${JSON.stringify({
      to: { participant: 'agent:builtin:lead', handle: 'lead' },
    })}, 'k1', '2026-01-01', 'pending'),
    ('q2', 'u1', 'child', 0, 'ticket', ${JSON.stringify({
      agentTurn: { speakerAgentId: 'builtin:lead', scope: { speakerAgentId: 'builtin:lead' } },
    })}, 'k2', '2026-01-01', 'pending')`.execute(db)
  await sql`INSERT INTO wake_outbox (delivery_key, user_id, session_id, request_json, created_at)
    VALUES ('o1', 'u1', 'child', ${JSON.stringify({
      to: { participant: 'agent:builtin:lead' },
    })}, '2026-01-01')`.execute(db)
  await sql`INSERT INTO agent_messages
      (id, user_id, session_id, sequence, role, payload_json, created_at, updated_at)
    VALUES ('m1', 'u1', 'child', 1, 'assistant', ${JSON.stringify({
      id: 'm1',
      role: 'assistant',
      from: 'agent:builtin:lead',
      authorSnapshot: { handle: 'lead' },
      to: 'agent:qa',
      toSnapshot: { handle: 'qa' },
      reactions: [
        { emoji: '👍', from: 'user', at: 'a' },
        { emoji: '🎉', from: 'agent:qa', at: 'b' },
      ],
    })}, '2026-01-01', '2026-01-01'),
    ('m2', 'u1', 'child', 2, 'assistant', ${JSON.stringify({
      id: 'm2',
      role: 'assistant',
      systemNotice: { kind: 'model_change', tone: 'neutral', text: 'x', participant: 'lead' },
    })}, '2026-01-01', '2026-01-01')`.execute(db)

  await migrateToLatest(db)

  const json = async (table: string, column: string, id: string) =>
    JSON.parse(
      (
        await sql<{ value: string }>`SELECT ${sql.ref(column)} AS value FROM ${sql.table(table)}
          WHERE id = ${id}`.execute(db)
      ).rows[0]!.value,
    )
  expect(await json('agent_sessions', 'invocation_json', 'child')).toEqual({
    kind: 'task-delegation',
    parentSessionId: 'root',
    toolCallId: 'c1',
  })
  expect(await json('agent_queue_items', 'payload_json', 'q1')).toEqual({})
  expect(await json('agent_queue_items', 'payload_json', 'q2')).toEqual({
    agentTurn: { scope: {} },
  })
  const outbox = await sql<{ request_json: string }>`SELECT request_json FROM wake_outbox`.execute(
    db,
  )
  expect(JSON.parse(outbox.rows[0]!.request_json)).toEqual({})
  expect(await json('agent_messages', 'payload_json', 'm1')).toEqual({
    id: 'm1',
    role: 'assistant',
    from: 'agent:builtin:lead',
    reactions: [{ emoji: '👍', from: 'user', at: 'a' }],
  })
  expect((await json('agent_messages', 'payload_json', 'm2')).systemNotice).toEqual({
    kind: 'model_change',
    tone: 'neutral',
    text: 'x',
  })
})
