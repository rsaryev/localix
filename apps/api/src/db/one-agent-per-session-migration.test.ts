import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261114T000000_one_agent_per_session'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

const columnsOf = async (db: ReturnType<typeof createDatabase>, table: string) =>
  (await sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.execute(db)).rows.map(
    (row) => row.name,
  )

const queued = (id: string, agentTurn: unknown) => ({
  id,
  payload: JSON.stringify({ agentTurn }),
})

/**
 * A conversation has one agent now. A session that had a room keeps the agent that joined first,
 * with its route, its frozen prompts and the fork seed; every row only the room protocol could
 * read is rewritten or removed so no reader has to know it.
 */
test('a room becomes a session with its earliest-joined agent', async () => {
  const db = createDatabase()
  databases.push(db)
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < BEFORE))
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })

  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, leaf_id)
    VALUES ('room', 'u1', 'Room', 'p1', 'after'), ('solo', 'u1', 'Solo', 'p1', NULL)`.execute(db)
  await sql`INSERT INTO conversation_participants
      (session_id, agent_id, handle, position, model_id, reasoning_effort, model_selected_at,
       reasoning_selected_at)
    VALUES
      ('room', 'native:qa', 'qa', 1, 'model-qa', 'low', NULL, NULL),
      ('room', 'builtin:localix', 'localix', 0, 'model-lead', 'high', 'at-1', 'at-2'),
      ('solo', 'builtin:localix', 'localix', 0, 'model-solo', 'medium', NULL, NULL)`.execute(db)
  const seed = (agent: string, boundary: string) =>
    sql`INSERT INTO participant_lane_snapshots
      (user_id, session_id, agent_id, boundary_marker, snapshot_json)
      VALUES ('u1', 'room', ${agent}, ${boundary}, ${JSON.stringify({ agent, boundary })})`
  await seed('builtin:localix', 'm-1').execute(db)
  await seed('native:qa', 'm-1').execute(db)
  await seed('fork', 'fork-seed').execute(db)

  await sql`INSERT INTO agent_messages (id, session_id, user_id, sequence, role, payload_json, parent_id)
    VALUES
      ('before', 'room', 'u1', 1, 'user', '{"content":"hi"}', NULL),
      ('joined', 'room', 'u1', 2, 'assistant',
        '{"systemNotice":{"kind":"participants_change","tone":"neutral","text":"qa joined."}}', 'before'),
      ('limit', 'room', 'u1', 3, 'assistant',
        '{"systemNotice":{"kind":"handoff_limit","tone":"neutral","text":"stopped"}}', 'joined'),
      ('after', 'room', 'u1', 4, 'user', '{"content":"go"}', 'limit')`.execute(db)

  await sql`INSERT INTO usage_events (message_id, session_id, user_id, model_id, finish_reason)
    VALUES ('before', 'room', 'u1', 'm', 'routing'), ('after', 'room', 'u1', 'm', 'end_turn')`.execute(
    db,
  )

  const ticket = (id: string, source: string, trigger?: string) =>
    queued(id, { source, scope: trigger ? { turnTrigger: { kind: trigger } } : {} })
  for (const [index, item] of [
    ticket('request', 'agent-request', 'colleague-request'),
    ticket('broadcast', 'user-broadcast'),
    ticket('colleague', 'runtime', 'colleague-request'),
    ticket('address', 'user-address'),
    queued('default', {
      source: 'user-default',
      scope: { conversationId: 'c1', handoffDepth: 2, turnTrigger: { kind: 'message' } },
    }),
  ].entries()) {
    await sql`INSERT INTO agent_queue_items
      (id, user_id, session_id, priority, kind, payload_json, delivery_key, queued_at)
      VALUES (${item.id}, 'u1', 'room', 1, 'agent-turn', ${item.payload}, ${`k-${index}`}, 'now')`.execute(
      db,
    )
  }

  await migrateToLatest(db)

  const sessions = await sql<Record<string, unknown>>`
    SELECT id, agent_id, agent_name, model_id, reasoning_effort, model_selected_at,
      reasoning_selected_at, leaf_id FROM agent_sessions ORDER BY id`.execute(db)
  expect(sessions.rows).toEqual([
    {
      id: 'room',
      agent_id: 'builtin:localix',
      agent_name: 'localix',
      model_id: 'model-lead',
      reasoning_effort: 'high',
      model_selected_at: 'at-1',
      reasoning_selected_at: 'at-2',
      leaf_id: 'after',
    },
    {
      id: 'solo',
      agent_id: 'builtin:localix',
      agent_name: 'localix',
      model_id: 'model-solo',
      reasoning_effort: 'medium',
      model_selected_at: null,
      reasoning_selected_at: null,
      leaf_id: null,
    },
  ])

  const snapshots = await sql<{ boundary_marker: string; snapshot_json: string }>`
    SELECT boundary_marker, snapshot_json FROM session_prompt_snapshots
    WHERE session_id = 'room' ORDER BY boundary_marker`.execute(db)
  expect(snapshots.rows.map((row) => JSON.parse(row.snapshot_json))).toEqual([
    { agent: 'fork', boundary: 'fork-seed' },
    { agent: 'builtin:localix', boundary: 'm-1' },
  ])

  const usage = await sql<{ finish_reason: string }>`
    SELECT finish_reason FROM usage_events ORDER BY message_id`.execute(db)
  expect(usage.rows.map((row) => row.finish_reason)).toEqual(['end_turn', 'decision'])

  const tickets = await sql<{ id: string; payload_json: string }>`
    SELECT id, payload_json FROM agent_queue_items ORDER BY id`.execute(db)
  expect(tickets.rows.map((row) => row.id)).toEqual(['address', 'default'])
  expect(tickets.rows.map((row) => JSON.parse(row.payload_json).agentTurn.source)).toEqual([
    'user-default',
    'user-default',
  ])

  const scopes = tickets.rows.map((row) => JSON.parse(row.payload_json).agentTurn.scope)
  expect(scopes[1]).toEqual({ conversationId: 'c1' })

  const messages = await sql<{ id: string; parent_id: string | null }>`
    SELECT id, parent_id FROM agent_messages ORDER BY sequence`.execute(db)
  expect(messages.rows).toEqual([
    { id: 'before', parent_id: null },
    { id: 'after', parent_id: 'before' },
  ])

  const tables = await sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table'`.execute(db)
  const names = tables.rows.map((row) => row.name)
  expect(names).not.toContain('conversation_participants')
  expect(names).not.toContain('participant_lane_snapshots')
  const sessionColumns = await columnsOf(db, 'agent_sessions')
  for (const dropped of ['conversation_mode', 'model_choices', 'avatar']) {
    expect(sessionColumns).not.toContain(dropped)
  }
  expect(await columnsOf(db, 'tool_output_artifacts')).not.toContain('participant')
})
