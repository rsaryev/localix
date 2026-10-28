import { sql, type Kysely } from 'kysely'

// A conversation has exactly one agent, fixed when it is created. The group-chat machinery that
// let several agents share a session is gone, and with it everything that stored its state:
//
//   conversation_participants       → the agent and its route are columns of `agent_sessions`
//                                     (a session with several rows keeps the earliest-joined one)
//   participant_lane_snapshots      → `session_prompt_snapshots`, one frozen prompt per boundary
//   agent_sessions.model_choices    → gone: it remembered routes for agents not yet invited
//   agent_sessions.avatar           → gone: a group's avatar
//   agent_sessions.conversation_mode→ gone: solo/group
//   tool_output_artifacts.participant → gone: an author check only a shared transcript needs
//
// Rows the old protocol left behind are removed so no reader has to know them: routing usage
// folds into decisions, queued colleague turns are dropped, and the join/leave and handoff-limit
// notices leave the transcript.
const ROUTE_COLUMNS = [
  ['agent_id', 'agent_id'],
  ['agent_handle', 'handle'],
  ['provider_connection_id', 'provider_connection_id'],
  ['model_id', 'model_id'],
  ['reasoning_effort', 'reasoning_effort'],
  ['model_selected_at', 'model_selected_at'],
  ['reasoning_selected_at', 'reasoning_selected_at'],
] as const

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN agent_id TEXT`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN agent_handle TEXT`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN provider_connection_id TEXT REFERENCES provider_connections (id) ON DELETE SET NULL`.execute(
    db,
  )
  await sql`ALTER TABLE agent_sessions ADD COLUMN model_id TEXT NOT NULL DEFAULT ''`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'`.execute(
    db,
  )
  await sql`ALTER TABLE agent_sessions ADD COLUMN model_selected_at TEXT`.execute(db)
  await sql`ALTER TABLE agent_sessions ADD COLUMN reasoning_selected_at TEXT`.execute(db)

  // The earliest-joined participant is the session's agent.
  await sql`
    CREATE TEMP TABLE kept_participant AS
    SELECT * FROM (
      SELECT p.*, row_number() OVER (PARTITION BY p.session_id ORDER BY p."position", p.agent_id) AS rn
      FROM conversation_participants p
    ) WHERE rn = 1
  `.execute(db)
  for (const [column, source] of ROUTE_COLUMNS) {
    const nullable = column !== 'model_id' && column !== 'reasoning_effort'
    const fallback = column === 'model_id' ? sql`''` : sql`'medium'`
    await sql`
      UPDATE agent_sessions SET ${sql.ref(column)} = ${
        nullable
          ? sql`(SELECT k.${sql.ref(source)} FROM kept_participant k WHERE k.session_id = agent_sessions.id)`
          : sql`coalesce((SELECT k.${sql.ref(source)} FROM kept_participant k WHERE k.session_id = agent_sessions.id), ${fallback})`
      }
    `.execute(db)
  }

  await sql`
    CREATE TABLE session_prompt_snapshots (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
      boundary_marker TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      PRIMARY KEY (session_id, user_id, boundary_marker)
    )
  `.execute(db)
  await sql`
    INSERT INTO session_prompt_snapshots (user_id, session_id, boundary_marker, snapshot_json)
    SELECT l.user_id, l.session_id, l.boundary_marker, l.snapshot_json
    FROM participant_lane_snapshots l
    JOIN agent_sessions s ON s.id = l.session_id
    WHERE l.agent_id = s.agent_id OR (l.agent_id = 'fork' AND l.boundary_marker = 'fork-seed')
  `.execute(db)
  await sql`DROP TABLE participant_lane_snapshots`.execute(db)
  await sql`DROP TABLE kept_participant`.execute(db)
  await sql`DROP TABLE conversation_participants`.execute(db)

  await sql`CREATE INDEX agent_sessions_agent_idx ON agent_sessions (agent_id)`.execute(db)
  await sql`CREATE INDEX agent_sessions_connection_idx ON agent_sessions (provider_connection_id)`.execute(
    db,
  )

  await sql`ALTER TABLE agent_sessions DROP COLUMN conversation_mode`.execute(db)
  await sql`ALTER TABLE agent_sessions DROP COLUMN model_choices`.execute(db)
  await sql`ALTER TABLE agent_sessions DROP COLUMN avatar`.execute(db)
  await sql`ALTER TABLE tool_output_artifacts DROP COLUMN participant`.execute(db)

  // Floor decisions were billed as 'routing'; every decision-model call is one kind now.
  await sql`UPDATE usage_events SET finish_reason = 'decision' WHERE finish_reason = 'routing'`.execute(
    db,
  )

  // Turns queued by the colleague protocol: a request or broadcast has nobody to run it, and a
  // tag-addressed turn is an ordinary reply now.
  await sql`
    DELETE FROM agent_queue_items
    WHERE json_valid(payload_json)
      AND (
        json_extract(payload_json, '$.agentTurn.source') IN ('agent-request', 'user-broadcast')
        OR json_extract(payload_json, '$.agentTurn.scope.turnTrigger.kind') = 'colleague-request'
      )
  `.execute(db)
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_set(payload_json, '$.agentTurn.source', 'user-default')
    WHERE json_valid(payload_json)
      AND json_extract(payload_json, '$.agentTurn.source') = 'user-address'
  `.execute(db)

  // Fields the protocol put on every stored ticket's scope.
  await sql`
    UPDATE agent_queue_items
    SET payload_json = json_remove(
      payload_json, '$.agentTurn.scope.handoffDepth', '$.agentTurn.scope.turnTrigger'
    )
    WHERE json_valid(payload_json)
      AND (
        json_type(payload_json, '$.agentTurn.scope.handoffDepth') IS NOT NULL
        OR json_type(payload_json, '$.agentTurn.scope.turnTrigger') IS NOT NULL
      )
  `.execute(db)

  await removeNotices(db, ['participants_change', 'handoff_limit'])
}

/** Delete notice rows, joining the rows that hung under each to the row above it. */
async function removeNotices(db: Kysely<unknown>, kinds: readonly string[]): Promise<void> {
  const rows = await sql<{ id: string; parent_id: string | null }>`
    SELECT id, parent_id FROM agent_messages
    WHERE json_valid(payload_json)
      AND json_extract(payload_json, '$.systemNotice.kind') IN (${sql.join(kinds)})
    ORDER BY session_id, sequence
  `.execute(db)
  for (const row of rows.rows) {
    const current = await sql<{ parent_id: string | null }>`
      SELECT parent_id FROM agent_messages WHERE id = ${row.id}
    `.execute(db)
    const parent = current.rows[0]?.parent_id ?? null
    await sql`UPDATE agent_messages SET parent_id = ${parent} WHERE parent_id = ${row.id}`.execute(
      db,
    )
    await sql`UPDATE agent_sessions SET leaf_id = ${parent} WHERE leaf_id = ${row.id}`.execute(db)
    await sql`DELETE FROM agent_messages WHERE id = ${row.id}`.execute(db)
  }
}
