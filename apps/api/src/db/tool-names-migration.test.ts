import { afterEach, expect, test } from 'bun:test'
import { sql, type Kysely } from 'kysely'

import { up } from '../../migrations/20261113T000000_tool_names'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { shippedMigrations } from './migration-provider'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

/** The migration rewrites the lane snapshots, a table the next migration replaces. */
async function migrateBeforeAgentColumns(db: ReturnType<typeof createDatabase>) {
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(
    Object.entries(all).filter(([name]) => name < '20261114T000000_one_agent_per_session'),
  )
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })
}

/**
 * Every built-in tool had an id of its own (`bash`, `global_search`) beside the name the model
 * called it by; each has one name now. A rule written for an id keeps governing the same tool, and
 * the usage and recovery rows keep naming it, so what a person switched off does not come back on.
 */
test('rows that name a tool by its old id name it by its one name', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateBeforeAgentColumns(db)
  const rule = (position: number, action: string, resource = '*') => ({
    user_id: 'u1',
    agent_id: 'native:qa',
    position,
    action,
    resource,
    effect: 'deny',
  })
  await db
    .insertInto('capability_rule')
    .values([
      rule(0, 'tool:bash'),
      rule(1, 'tool:bash', 'git push*'),
      rule(2, 'tool:global_search'),
      rule(3, 'tool:Agent'),
      rule(4, 'tool:chess'),
      rule(5, 'skill:read'),
      rule(6, 'tool:*'),
    ])
    .execute()
  await sql`INSERT INTO tool_usage (id, user_id, project_id, tool_name, first_seen_at, created_at, updated_at)
    VALUES ('t1', 'u1', 'p1', 'read', 'a', 'a', 'a'), ('t2', 'u1', 'p1', 'chess', 'a', 'a', 'a')`.execute(
    db,
  )

  await up(db as unknown as Kysely<unknown>)

  const rules = await db
    .selectFrom('capability_rule')
    .select(['action', 'resource'])
    .orderBy('position')
    .execute()
  expect(rules).toEqual([
    { action: 'tool:Bash', resource: '*' },
    { action: 'tool:Bash', resource: 'git push*' },
    { action: 'tool:GlobalSearch', resource: '*' },
    { action: 'tool:Agent', resource: '*' },
    { action: 'tool:chess', resource: '*' },
    { action: 'skill:read', resource: '*' },
    { action: 'tool:*', resource: '*' },
  ])
  const usage = await db.selectFrom('tool_usage').select('tool_name').orderBy('id').execute()
  expect(usage.map((row) => row.tool_name)).toEqual(['Read', 'chess'])
})

test('a session keeps the deferred tools it activated, under their names', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateBeforeAgentColumns(db)
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id, activated_tools)
    VALUES ('s1', 'u1', 't', 'p1', '["configure","mcp_github_issue","external_agent_sessions"]')`.execute(
    db,
  )

  await up(db as unknown as Kysely<unknown>)

  const row = await db
    .selectFrom('agent_sessions')
    .select('activated_tools')
    .where('id', '=', 's1')
    .executeTakeFirstOrThrow()
  expect(JSON.parse(row.activated_tools!)).toEqual([
    'Configure',
    'mcp_github_issue',
    'ExternalAgentSessions',
  ])
})

test('stored items, results, checkpoints and fork seeds name their tools by the one name', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateBeforeAgentColumns(db)
  await sql`INSERT INTO agent_sessions (id, user_id, title, project_id)
    VALUES ('s1', 'u1', 't', 'p1')`.execute(db)
  const payload = {
    id: 'm1',
    role: 'assistant',
    items: [
      { type: 'text', id: 'a', name: 'read', text: 'read the file' },
      { type: 'tool_call', id: 'b', name: 'global_search', status: 'completed' },
      { type: 'command', id: 'c', name: 'bash', command: 'ls' },
      { type: 'file_change', id: 'd', name: 'edit', changes: [] },
      { type: 'tool_call', id: 'e', name: 'mcp__github__read' },
      { type: 'tool_call', id: 'f', name: 'chess' },
    ],
    results: [{ type: 'tool_result', toolCallId: 'b', toolName: 'activate_tools' }],
  }
  await sql`INSERT INTO agent_messages (id, session_id, user_id, sequence, role, payload_json, created_at, updated_at)
    VALUES ('m1', 's1', 'u1', 1, 'assistant', ${JSON.stringify(payload)}, 'a', 'a')`.execute(db)
  const seed = {
    tools: [
      { name: 'bash', modelName: 'Bash', description: 'd', schema: {} },
      { name: 'chess', description: 'd', schema: {} },
    ],
    toolNames: ['bash', 'chess'],
    profile: {
      toolExposure: { bash: 'direct', chess: 'deferred' },
      declaredTools: ['read', 'chess'],
    },
  }
  await sql`INSERT INTO participant_lane_snapshots (user_id, session_id, agent_id, boundary_marker, snapshot_json)
    VALUES ('u1', 's1', 'seed', 'fork', ${JSON.stringify(seed)})`.execute(db)

  await up(db as unknown as Kysely<unknown>)

  const message = await db
    .selectFrom('agent_messages')
    .select('payload_json')
    .where('id', '=', 'm1')
    .executeTakeFirstOrThrow()
  const stored = JSON.parse(message.payload_json)
  expect(stored.items.map((item: { name: string }) => item.name)).toEqual([
    'read', // a text item is not a tool call
    'GlobalSearch',
    'Bash',
    'Edit',
    'mcp__github__read',
    'chess',
  ])
  expect(stored.items[0].text).toBe('read the file')
  expect(stored.results[0].toolName).toBe('ToolSearch')
  // The table this migration rewrites no longer exists in the current schema.
  const lane = await sql<{ snapshot_json: string }>`
    SELECT snapshot_json FROM participant_lane_snapshots`.execute(db)
  const forked = JSON.parse(lane.rows[0]!.snapshot_json)
  expect(forked.tools).toEqual([
    { name: 'Bash', description: 'd', schema: {} },
    { name: 'chess', description: 'd', schema: {} },
  ])
  expect(forked.toolNames).toEqual(['Bash', 'chess'])
  expect(forked.profile).toEqual({
    toolExposure: { Bash: 'direct', chess: 'deferred' },
    declaredTools: ['Read', 'chess'],
  })
})

test('a usage row that already counts the new name takes the old row’s counts', async () => {
  const db = createDatabase()
  databases.push(db)
  await migrateBeforeAgentColumns(db)
  await sql`INSERT INTO tool_usage (id, user_id, project_id, tool_name, call_count, error_count, first_seen_at, last_used_at, created_at, updated_at)
    VALUES ('t1', 'u1', 'p1', 'bash', 3, 1, '2026-01-02', '2026-02-01', 'a', 'a'),
           ('t2', 'u1', 'p1', 'Bash', 4, 0, '2026-01-05', '2026-03-01', 'a', 'a')`.execute(db)

  await up(db as unknown as Kysely<unknown>)

  const rows = await db.selectFrom('tool_usage').selectAll().execute()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    tool_name: 'Bash',
    call_count: 7,
    error_count: 1,
    first_seen_at: '2026-01-02',
    last_used_at: '2026-03-01',
  })
})
