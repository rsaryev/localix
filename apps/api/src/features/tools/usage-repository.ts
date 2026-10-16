import { randomUUID } from 'node:crypto'

import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'

/** One tool's observed history in one scope. Timestamps are ISO strings, as stored. */
export interface ToolUsageRecord {
  toolName: string
  calls: number
  errors: number
  firstSeenAt: string
  lastUsedAt: string | null
}

export interface ToolUsageRepository {
  /**
   * Count one call. Creates the row if this is the first time the tool is seen at all —
   * a call is itself proof of availability, so it can stand in for a roster write.
   */
  recordUse(
    userId: string,
    projectId: string,
    toolName: string,
    options?: { isError?: boolean; at?: string },
  ): Promise<void>
  /**
   * Mark these tools as AVAILABLE without counting a call. Idempotent by construction: an
   * existing row is left completely untouched, so a run's roster write can never disturb counts
   * or move `first_seen_at` later.
   */
  recordRoster(
    userId: string,
    projectId: string,
    toolNames: readonly string[],
    at?: string,
  ): Promise<void>
  list(userId: string, projectId: string): Promise<ToolUsageRecord[]>
}

export function createToolUsageRepository(db: Kysely<AppDatabase>): ToolUsageRepository {
  const now = () => new Date().toISOString()

  return {
    /**
     * One statement, atomic. The obvious implementation — read the row, write `count + 1` — is
     * the lost-update shape this repo has already been bitten by twice (`f77c92fc8`,
     * `c47b137e1`), and tools are exactly where it would bite: `executionMode: 'parallel'` means
     * several calls genuinely resolve in the same tick, and sub-agents in one tree share a scope.
     * SQLite does the arithmetic inside the conflict resolution, so no interleaving is possible.
     */
    async recordUse(userId, projectId, toolName, options) {
      const ts = options?.at ?? now()
      const errorDelta = options?.isError ? 1 : 0
      await sql`
        INSERT INTO tool_usage (
          id, user_id, project_id, tool_name,
          call_count, error_count, first_seen_at, last_used_at, created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${projectId}, ${toolName},
          1, ${errorDelta}, ${ts}, ${ts}, ${ts}, ${ts}
        )
        ON CONFLICT(user_id, project_id, tool_name) DO UPDATE SET
          call_count = call_count + 1,
          error_count = error_count + ${errorDelta},
          last_used_at = ${ts},
          updated_at = ${ts}
      `.execute(db)
    },

    /**
     * `DO NOTHING`, deliberately — not "update first_seen_at to the earlier value". A row that
     * exists already has the earliest observation by definition, and rewriting it on every run
     * would turn a once-per-tool write into a once-per-run write over the whole surface.
     *
     * The batch is NOT deduplicated first. It used to be, with a comment asserting that "one
     * statement carrying the same conflict target twice is an error in SQLite". Measured against
     * the real database: it is not — a multi-row INSERT with a repeated conflict target and
     * `DO NOTHING` inserts the first and skips the rest, returning exactly the distinct set. The
     * `Set` was dead weight resting on a false claim, and removing it broke no test, which is how
     * it was found.
     *
     * Empty names ARE still filtered: an empty `tool_name` would be a real row keyed on nothing.
     */
    async recordRoster(userId, projectId, toolNames, at) {
      const names = toolNames.filter((name) => name.length > 0)
      if (names.length === 0) return
      const ts = at ?? now()
      await db
        .insertInto('tool_usage')
        .values(
          names.map((toolName) => ({
            id: randomUUID(),
            user_id: userId,
            project_id: projectId,
            tool_name: toolName,
            call_count: 0,
            error_count: 0,
            first_seen_at: ts,
            last_used_at: null,
            created_at: ts,
            updated_at: ts,
          })),
        )
        .onConflict((oc) => oc.columns(['user_id', 'project_id', 'tool_name']).doNothing())
        .execute()
    },

    async list(userId, projectId) {
      const rows = await db
        .selectFrom('tool_usage')
        .select(['tool_name', 'call_count', 'error_count', 'first_seen_at', 'last_used_at'])
        .where('user_id', '=', userId)
        .where('project_id', '=', projectId)
        .execute()
      return rows.map((row) => ({
        toolName: row.tool_name,
        calls: row.call_count,
        errors: row.error_count,
        firstSeenAt: row.first_seen_at,
        lastUsedAt: row.last_used_at,
      }))
    },
  }
}
