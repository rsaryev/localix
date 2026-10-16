import { sql, type Kysely } from 'kysely'

/** Personal instructions now belong to agent definitions; retain both settings envelopes. */
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const column of [
    'name',
    'role',
    'expertise',
    'preferences',
    'working_context',
    'experience_level',
    'main_use_case',
    'response_defaults',
  ]) {
    await sql`ALTER TABLE user_profiles DROP COLUMN ${sql.id(column)}`.execute(db)
  }
  await sql`
    UPDATE participant_lane_snapshots
    SET snapshot_json = json_remove(snapshot_json, '$.userProfile', '$.responseDefaults')
    WHERE json_valid(snapshot_json)
  `.execute(db)
}
