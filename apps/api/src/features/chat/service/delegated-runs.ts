import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../../db/types'
import type { DelegatedRunSummary } from '../../agent-core/tools/agents'
import { DELEGATION_PRIORITIES, type DelegationPriority } from '../../agent-core/delegation-lanes'
import { createUsageRepository } from '../../usage/repository'
import { readSessionUsageRows, summarizeSessionUsageFromTurns } from '../../usage/session-summary'
import { createChatRepository } from '../repository'

const isDelegationPriority = (value: unknown): value is DelegationPriority =>
  (DELEGATION_PRIORITIES as readonly unknown[]).includes(value)

/** Deeper than any ladder allows (`delegation-hierarchy.ts`); a backstop against a stored cycle. */
const MAX_SUBTREE_LEVELS = 4

/**
 * Everything BELOW one session — its children, theirs, and so on — each row with its level.
 *
 * Below, never above: a session sees the work its delegation put in motion and what it costs,
 * and nothing of the agents that delegated to it. It MANAGES only level 1; the tool refuses a
 * deeper row (`agents-control.ts`). A tree-wide list used to hand the root its grandchildren as
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
      .select(['s.id', 's.task_name', 's.runtime_status', 's.updated_at', 's.closed_at'])
      .select(['s.parent_session_id', 'tree.level'])
      .select(sql<string | null>`json_extract(s.invocation_json, '$.priority')`.as('priority'))
      .select(
        sql<
          string | null
        >`(SELECT a.agent_id FROM conversation_participants a WHERE a.session_id = s.id ORDER BY a.position LIMIT 1)`.as(
          'agent_id',
        ),
      )
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

/**
 * What a child has consumed: the SAME canonical total its own composer shows as "Session total"
 * (`summarizeSessionUsageFromTurns` — its active branch's turns plus every auxiliary call).
 *
 * It was a second sum, over every branch and without the auxiliary calls, so one agent carried
 * two different numbers — one in its delegator's `runs`, another in its own chat.
 */
async function sessionSpend(
  db: Kysely<AppDatabase>,
  userId: string,
  sessionId: string,
): Promise<NonNullable<DelegatedRunSummary['usage']>> {
  const [turns, ledger] = await Promise.all([
    createChatRepository(db).getActiveBranchUsage(userId, sessionId),
    readSessionUsageRows(createUsageRepository(db), userId, sessionId),
  ])
  const usage = summarizeSessionUsageFromTurns(turns, ledger).usage
  return { tokens: usage?.totalTokens ?? 0, costUsd: usage?.totalCost ?? null }
}

/** One public projection for the tool and prompt; never copy reasoning or full tool traces. */
export async function listDelegatedRuns(
  db: Kysely<AppDatabase>,
  userId: string,
  parentSessionId: string,
  /** `usage: false` for a reader that shows none (the prompt's roster), sparing its reads. */
  opts: { usage?: boolean } = {},
): Promise<DelegatedRunSummary[]> {
  const rows = await delegatedRunsQuery(db, userId, parentSessionId).execute()
  const spend =
    opts.usage === false
      ? undefined
      : await Promise.all(rows.map((row) => sessionSpend(db, userId, row.id)))
  return rows.map((row, index) => ({
    sessionId: row.id,
    taskName: row.task_name ?? row.id,
    // A closed child is terminal whatever its last run did — the one status nothing changes again.
    status: row.closed_at ? 'closed' : row.runtime_status,
    // A child delegated before priorities existed has none stored; it queues as `normal`.
    priority: isDelegationPriority(row.priority) ? row.priority : 'normal',
    ...(spend ? { usage: spend[index]! } : {}),
    agentId: row.agent_id ?? undefined,
    updatedAt: row.updated_at,
    progress:
      row.progress ||
      (row.last_tool ? `Last observed tool: ${row.last_tool}` : 'No public progress yet'),
    reportAvailable: row.runtime_status === 'completed' && Boolean(row.progress),
    level: Number(row.level),
    ...(row.parent_session_id ? { parentSessionId: row.parent_session_id } : {}),
  }))
}
