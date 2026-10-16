import { sql, type Kysely } from 'kysely'

/**
 * A session's model choices, independent of who is in it: JSON
 * `{ "all": route | null, "agents": { "<agentId>": route } }`, where a route is
 * `{ providerConnectionId, modelId, reasoningEffort }`. An agent that joins takes its own entry,
 * else `all`. Null for a session nobody has chosen a model in; its participants keep their rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE agent_sessions ADD COLUMN model_choices TEXT`.execute(db)
}
