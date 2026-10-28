import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'

/** Deeper than any ladder allows (`delegation-hierarchy.ts`); a backstop against a stored cycle. */
const MAX_SUBTREE_LEVELS = 4

/**
 * Everything BELOW one session — its children, theirs, and so on — each row with its level.
 *
 * Below, never above: a session sees the work its delegation put in motion and what it costs,
 * and nothing of the agents that delegated to it. It MANAGES only level 1; the tool refuses a
 * deeper row (`agent-control.ts`). A tree-wide list used to hand the root its grandchildren as
 * if they were its own children, with no way to tell them apart.
 *
 * Bounded projection: expand only the latest assistant's items, never the entire transcript.
 */
export function delegatedRunsQuery(
  db: Kysely<AppDatabase>,
  userId: string,
  parentSessionId: string,
) {
  return (
    db
      .withRecursive('tree(id, level)', (qb) =>
        qb
          .selectFrom('agent_sessions')
          .select(['id', sql<number>`1`.as('level')])
          .where('user_id', '=', userId)
          .where('parent_session_id', '=', parentSessionId)
          .where(sql<string>`+session_kind`, '=', 'subagent')
          .unionAll((child) =>
            child
              .selectFrom('agent_sessions as c')
              .innerJoin('tree', 'tree.id', 'c.parent_session_id')
              .select(['c.id', sql<number>`tree.level + 1`.as('level')])
              .where('c.user_id', '=', userId)
              .where(sql<string>`+c.session_kind`, '=', 'subagent')
              .where('tree.level', '<', MAX_SUBTREE_LEVELS),
          ),
      )
      .selectFrom('agent_sessions as s')
      .innerJoin('tree', 'tree.id', 's.id')
      .select(['s.id', 's.title', 's.task_name', 's.runtime_status', 's.updated_at', 's.closed_at'])
      .select(['s.parent_session_id', 'tree.level'])
      .select(sql<string | null>`json_extract(s.invocation_json, '$.priority')`.as('priority'))
      .select(sql<string | null>`json_extract(s.invocation_json, '$.name')`.as('name'))
      .select(sql<string | null>`json_extract(s.invocation_json, '$.agentType')`.as('agent_type'))
      .select(sql<string | null>`s.agent_id`.as('agent_id'))
      .select(
        sql<string | null>`(SELECT substr(json_extract(m.payload_json, '$.content'), 1, 240)
      FROM agent_messages m WHERE m.session_id = s.id AND m.role = 'assistant'
      ORDER BY m.sequence DESC LIMIT 1)`.as('progress'),
      )
      .select(
        sql<string | null>`(SELECT json_extract(i.value, '$.name') FROM json_each(
        (SELECT m.payload_json FROM agent_messages m WHERE m.session_id = s.id AND m.role = 'assistant'
          ORDER BY m.sequence DESC LIMIT 1), '$.items') i
      WHERE json_extract(i.value, '$.type') IN ('tool_call', 'command', 'file_change')
      ORDER BY i.key DESC LIMIT 1)`.as('last_tool'),
      )
      // The tree already scoped the rows; the unary `+` on `session_kind` above keeps that column
      // out of index selection, where the planner tied the recovery index (user, kind) — every
      // child the user has — against the parent index (user, parent) and picked the wide one.
      .orderBy('tree.level', 'asc')
      .orderBy('s.created_at', 'desc')
      .orderBy('s.seq', 'desc')
      .limit(100)
  )
}
