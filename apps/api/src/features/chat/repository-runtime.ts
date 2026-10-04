import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { agentTaskPathHasPrefix } from '../agent-core/agent-task-name'
import type { SessionRecord } from './repository-types'

// Runtime-facing session reads/writes: the unscoped identity lookups the stop path
// uses, the durable user-cancel flag and its boot sweep, the delegation-budget counts, and
// agent-name resolution inside one tree. Split out of repository.ts.

export function createRuntimeQueries(db: Kysely<AppDatabase>) {
  return {
    // ---- Session reads/writes for the runtime --------------------------------

    /** Owner + runtime status of a session by id (no user scoping — used by stop). */
    async getSessionRuntime(
      id: string,
    ): Promise<{ userId: string; runtimeStatus: SessionRecord['runtimeStatus'] } | null> {
      const row = await db
        .selectFrom('agent_sessions')
        .select(['user_id', 'runtime_status'])
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? { userId: row.user_id, runtimeStatus: row.runtime_status ?? 'idle' } : null
    },

    /** Parent id + kind of a session — drives the sub-agent depth guard. */
    async getSessionParent(id: string): Promise<{
      parentSessionId: string | null
      sessionKind: SessionRecord['sessionKind']
    } | null> {
      const row = await db
        .selectFrom('agent_sessions')
        .select(['parent_session_id', 'session_kind'])
        .where('id', '=', id)
        .executeTakeFirst()
      return row
        ? {
            parentSessionId: row.parent_session_id ?? null,
            sessionKind: row.session_kind ?? 'chat',
          }
        : null
    },

    /**
     * Mark every session still flagged 'running' as 'stopped'. Called once at
     * boot to reconcile orphaned runtime state (no live run survives a restart).
     */
    /**
     * Reclassify sessions left `running` by a dead process, so the UI stops showing ghost
     * sub-agents/jobs with an inert Stop button.
     *
     * NOT a source of "which runs were interrupted": a CHAT session never reaches `'running'`
     * (`markRuntimeSessionStatus` returns early for chat, `createSession` starts it `'idle'`), so
     * this column only ever sees workers. The interrupted-run evidence lives in `agent_runs` —
     * see `takeInterruptedRuns` in db/migrator.ts.
     */
    async markRunningSessionsStopped(): Promise<void> {
      await db
        .updateTable('agent_sessions')
        .set({ runtime_status: 'stopped' })
        .where('runtime_status', '=', 'running')
        .execute()
    },

    /**
     * How many children this conversation created since the PERSON last wrote in it — what the
     * delegation budget is evaluated against (`delegation-budget.ts`).
     *
     * Counted from the root's latest visible user row, so only the person resets it: a wake, a
     * child's report or a hidden internal turn is a user-role row too, and letting those reset
     * the count would let an agent refill its own budget by being woken. A conversation the
     * person has never written in counts from its start.
     *
     * Columns that already exist, as before: a tree is exactly a root and its children
     * (nesting is forbidden), which `root_session_id` describes.
     */
    async countDelegationsSinceHuman(userId: string, rootSessionId: string): Promise<number> {
      const lastHuman = db
        .selectFrom('agent_messages')
        .select((eb) => eb.fn.max('created_at').as('at'))
        .where('user_id', '=', userId)
        .where('session_id', '=', rootSessionId)
        .where('role', '=', 'user')
        .where(sql<number>`coalesce(json_extract(payload_json, '$.isInternal'), 0)`, '=', 0)
      const row = await db
        .selectFrom('agent_sessions')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('user_id', '=', userId)
        .where('root_session_id', '=', rootSessionId)
        .where('session_kind', '=', 'subagent')
        .where(sql<boolean>`created_at > coalesce((${lastHuman}), '')`)
        .executeTakeFirst()
      return Number(row?.count ?? 0)
    },

    /**
     * The different agents a session's open children involve — what the delegation ladder counts
     * (`delegation-hierarchy.ts`). A closed child involves nobody any more: closing it is how a
     * session frees the room to bring in someone else.
     */
    async delegatedAgentsOf(userId: string, parentSessionId: string): Promise<string[]> {
      const rows = await db
        .selectFrom('agent_sessions as s')
        .innerJoin('conversation_participants as p', 'p.session_id', 's.id')
        .select('p.agent_id')
        .distinct()
        .where('s.user_id', '=', userId)
        .where('s.parent_session_id', '=', parentSessionId)
        .where('s.session_kind', '=', 'subagent')
        .where('s.closed_at', 'is', null)
        .execute()
      return rows.map((row) => row.agent_id)
    },

    /**
     * Resolve one already-canonical agent name to a session id inside ONE tree.
     *
     * Scoped by `root_session_id` AND `user_id`, not by name alone: a name is only unique within a
     * tree, and the tree is also the trust boundary — an agent must not be able to reach into
     * another conversation (or another user's) by guessing an address. Hits the
     * `(root_session_id, task_name)` unique index as a point lookup.
     *
     * The caller resolves a relative reference to a canonical one first
     * (`resolveAgentTaskReference`); this method never interprets a name, because a store that
     * "helpfully" matches a near-miss is exactly how a message reaches the wrong agent.
     */
    async findSessionIdByTaskName(
      userId: string,
      rootSessionId: string,
      taskName: string,
    ): Promise<string | null> {
      const row = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('user_id', '=', userId)
        .where('root_session_id', '=', rootSessionId)
        .where('task_name', '=', taskName)
        .executeTakeFirst()
      return row?.id ?? null
    },

    /**
     * Every ADDRESSABLE session in one tree, optionally narrowed to a canonical path prefix —
     * the backing read for delegated-run history.
     *
     * The prefix is filtered in TypeScript on purpose. A SQL `LIKE 'prefix%'` cannot express it:
     * `_` is LIKE's single-character wildcard and these names are underscore-heavy, so
     * `'/root/audit_repo%'` would also match `/root/auditXrepo`, silently listing agents from a
     * branch the caller did not ask about. The row set is bounded by the delegation budget (a tree is a
     * root plus its children), the scan is served by the same tree index, and the segment-aligned
     * rule then lives in exactly one tested place (`agentTaskPathHasPrefix`).
     */
    async listTreeAgentNames(
      userId: string,
      rootSessionId: string,
      pathPrefix?: string,
    ): Promise<
      { sessionId: string; taskName: string; runtimeStatus: string; sessionKind: string }[]
    > {
      const rows = await db
        .selectFrom('agent_sessions')
        .select(['id', 'task_name', 'runtime_status', 'session_kind'])
        .where('user_id', '=', userId)
        .where('root_session_id', '=', rootSessionId)
        .where('task_name', 'is not', null)
        .orderBy('task_name', 'asc')
        .execute()
      const entries = []
      for (const row of rows) {
        if (!row.task_name) continue
        if (pathPrefix && !agentTaskPathHasPrefix(row.task_name, pathPrefix)) continue
        entries.push({
          sessionId: row.id,
          taskName: row.task_name,
          runtimeStatus: row.runtime_status ?? 'idle',
          sessionKind: row.session_kind ?? 'chat',
        })
      }
      return entries
    },
  }
}
