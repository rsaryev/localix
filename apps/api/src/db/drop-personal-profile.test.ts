import { expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { shippedMigrations } from './migration-provider'

test('removes personal fields and frozen copies while preserving settings and memory', async () => {
  const db = createDatabase()
  const migrationName = '20261012T000000_drop_personal_profile'
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < migrationName))
  try {
    await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })
    await sql`
      INSERT INTO user_profiles (user_id, name, role, expertise, preferences, working_context,
        experience_level, main_use_case, response_defaults, ui_settings, agent_settings)
      VALUES ('profile-test', 'Name', 'Role', 'Expertise', 'Preferences', 'Context',
        'senior', 'write-code', 'Concise', '{"fontSize":"lg"}', '{"maxTurns":25}')
    `.execute(db)
    // Insert against the historical schema, before newer session columns exist.
    await sql`INSERT INTO agent_sessions (id, user_id, title, project_id)
      VALUES ('room', 'profile-test', 'Room', 'project')`.execute(db)
    await sql`INSERT INTO conversation_participants (session_id, agent_id, handle, model_id)
      VALUES ('room', 'assistant', 'assistant', '')`.execute(db)
    await sql`INSERT INTO participant_lane_snapshots
      (user_id, session_id, agent_id, boundary_marker, snapshot_json)
      VALUES ('profile-test', 'room', 'assistant', '', ${JSON.stringify({
        userProfile: 'Name',
        responseDefaults: 'Concise',
        memoryContext: 'Remember this',
      })})`.execute(db)

    await migrateToLatest(db)
    const columns = await sql<{ name: string }>`PRAGMA table_info(user_profiles)`.execute(db)
    expect(columns.rows.map((column) => column.name).sort()).toEqual(
      ['user_id', 'ui_settings', 'agent_settings', 'updated_at'].sort(),
    )
    const row = await db
      .selectFrom('user_profiles')
      .selectAll()
      .where('user_id', '=', 'profile-test')
      .executeTakeFirstOrThrow()
    expect(row.ui_settings).toBe('{"fontSize":"lg"}')
    expect(row.agent_settings).toBe('{"maxTurns":25}')
    const snapshot = await db
      .selectFrom('session_prompt_snapshots')
      .select('snapshot_json')
      .executeTakeFirstOrThrow()
    expect(JSON.parse(snapshot.snapshot_json)).toEqual({ memoryContext: 'Remember this' })
  } finally {
    await destroyDatabase(db)
  }
})
