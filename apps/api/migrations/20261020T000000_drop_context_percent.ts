import { sql, type Kysely } from 'kysely'

/**
 * The share-of-window context setting is gone: its per-agent/model `contextPercent` would fail the
 * strict settings schema and stop the whole settings blob validating. Remove it from every entry,
 * and drop an entry it was the only setting of (the shape `setAgentModelSettings` keeps).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE user_profiles
    SET agent_settings = json_set(
      agent_settings,
      '$.agentModelSettings',
      (
        SELECT json_group_array(json(cleaned))
        FROM (
          SELECT json_remove(entry.value, '$.contextPercent') AS cleaned
          FROM json_each(agent_settings, '$.agentModelSettings') AS entry
          ORDER BY entry.key
        )
        WHERE json_type(cleaned, '$.effort') IS NOT NULL
          OR json_type(cleaned, '$.maxTurns') IS NOT NULL
          OR json_type(cleaned, '$.contextLimit') IS NOT NULL
      )
    )
    WHERE json_valid(agent_settings)
      AND json_type(agent_settings, '$.agentModelSettings') = 'array'
      AND EXISTS (
        SELECT 1
        FROM json_each(agent_settings, '$.agentModelSettings') AS entry
        WHERE json_type(entry.value, '$.contextPercent') IS NOT NULL
      )
  `.execute(db)
}
