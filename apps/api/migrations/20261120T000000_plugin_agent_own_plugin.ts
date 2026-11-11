import { sql, type Kysely } from 'kysely'

// A plugin's agent starts with its own plugin on (`agents/bindings/bindings.ts`). One bound before
// that has no rule on its plugin, so it ran without its own skills and hooks: it gets the rule a new
// one starts with, last in its list. One whose plugin someone switched off or on keeps that rule.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO capability_rule (user_id, agent_id, position, action, resource, effect)
    SELECT s.user_id, s.name,
      COALESCE((SELECT MAX(r.position) + 1 FROM capability_rule r
        WHERE r.user_id = s.user_id AND r.agent_id = s.name), 0),
      'plugin:' || substr(s.source, 8), '*', 'allow'
    FROM capability_source s
    WHERE s.kind = 'agent' AND s.source LIKE 'plugin:%'
      AND NOT EXISTS (SELECT 1 FROM capability_rule r
        WHERE r.user_id = s.user_id AND r.agent_id = s.name
          AND r.action = 'plugin:' || substr(s.source, 8) AND r.resource = '*')
  `.execute(db)
}
