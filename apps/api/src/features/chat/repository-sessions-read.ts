import { parseSessionProvenance } from './session-provenance'
import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { mapSession } from './repository-mappers'
import { routeFromRow } from './repository-session-agent'
import { createChatProjectionQueries } from './repository-chat-projections'
import { lastMessagesByUser } from './repository-last-message'
import type { SessionRecord } from './repository-types'
import { MAX_SESSION_ANCESTRY_DEPTH } from './session-ancestry'

// Read-only session queries: the list/projection surfaces the UI and the runtime
// poll, plus the point lookups. Split out of repository.ts; every method here is a
// pure db read, so the module needs nothing but the connection.

export function createSessionReadQueries(db: Kysely<AppDatabase>) {
  return {
    async listSessions(userId: string): Promise<SessionRecord[]> {
      const rows = await db
        .selectFrom('agent_sessions')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('is_pinned', 'desc')
        .orderBy('updated_at', 'desc')
        .execute()

      return rows.map(mapSession)
    },

    /** Fresh, narrow roster for detecting concurrently running chats in one working directory. */
    async listRunningChatWorkspaces(userId: string) {
      return db
        .selectFrom('agent_sessions as session')
        .leftJoin('projects as project', (join) =>
          join
            .onRef('project.id', '=', 'session.project_id')
            .onRef('project.user_id', '=', 'session.user_id'),
        )
        .select([
          'session.id',
          'session.title',
          'session.project_id',
          'session.root_session_id',
          'session.execution_backend',
          'session.execution_target',
          'project.working_dir',
        ])
        .where('session.user_id', '=', userId)
        .where('session.session_kind', '=', 'chat')
        .where('session.runtime_status', '=', 'running')
        .orderBy('session.updated_at', 'desc')
        .execute()
    },

    /**
     * Rows for the session search index, narrowed to one project or unnarrowed.
     *
     * `null` and `undefined` both mean "every project" now. They used to differ — null selected
     * the PROJECT-LESS sessions — and that set no longer exists: every session belongs to a
     * project, because "no project" resolved to the global capability scope.
     */
    async listSessionSearchRows(userId: string, projectId?: string | null) {
      let query = db
        .selectFrom('agent_sessions')
        .select(['id', 'title', 'project_id', 'parent_session_id', 'session_kind'])
        .where('user_id', '=', userId)
      if (projectId) {
        query = query.where('project_id', '=', projectId)
      }
      const rows = await query.orderBy('updated_at', 'desc').execute()
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        projectId: row.project_id ?? null,
        parentSessionId: row.parent_session_id ?? null,
        sessionKind: row.session_kind,
      }))
    },

    /**
     * Project digests and chat navigation share this exact root-chat view.
     * Keep its scope, topology, projection, and ordering in SQLite so opening
     * either surface never deserializes the user's unrelated wide session rows.
     */
    async listProjectRootChatSessions(userId: string, projectId: string) {
      const rows = await db
        .selectFrom('agent_sessions')
        .select(['id', 'title', 'runtime_status', 'updated_at'])
        .where('user_id', '=', userId)
        .where('project_id', '=', projectId)
        .where('session_kind', '=', 'chat')
        .where('parent_session_id', 'is', null)
        .orderBy('updated_at', 'desc')
        .execute()
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        runtimeStatus: row.runtime_status ?? 'idle',
        updatedAt: row.updated_at,
      }))
    },

    /**
     * One agent run shares this view between authoritative ancestry resolution
     * and descendant prompt context. Both need topology and live labels only;
     * avoid parsing provenance, pinned skills, and other wide JSON fields.
     */
    async listRunSessionSnapshotRows(userId: string) {
      const rows = await db
        .selectFrom('agent_sessions')
        .select([
          'id',
          'user_id',
          'parent_session_id',
          'session_kind',
          'runtime_status',
          'title',
          // WHO created it, not just which session did.
          'invocation_json',
        ])
        .where('user_id', '=', userId)
        .execute()
      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        parentSessionId: row.parent_session_id,
        sessionKind: row.session_kind,
        runtimeStatus: row.runtime_status ?? 'idle',
        title: row.title,
        provenance: parseSessionProvenance(row.invocation_json),
      }))
    },

    ...createChatProjectionQueries(db),

    /** Each of one user's sessions' last message preview, keyed by session id. */
    lastMessagesByUser: (userId: string) => lastMessagesByUser(db, userId),

    async getSession(userId: string, id: string): Promise<SessionRecord | null> {
      const row = await db
        .selectFrom('agent_sessions')
        .selectAll()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()

      return row ? mapSession(row) : null
    },

    /**
     * Edit prediction and inline completion resolve their model before every
     * auxiliary request. Keep that hot path off the wide session mapper and its
     * JSON fields; it needs only these three owner-scoped routing columns.
     */
    async getSessionAgentRoute(userId: string, id: string) {
      const row = await db
        .selectFrom('agent_sessions')
        .select([
          'agent_sessions.provider_connection_id',
          'agent_sessions.model_id',
          'agent_sessions.reasoning_effort',
          'agent_sessions.agent_id',
          'agent_sessions.project_id',
          'agent_sessions.id',
        ])
        .where('agent_sessions.user_id', '=', userId)
        .where('agent_sessions.id', '=', id)
        .executeTakeFirst()

      return row
        ? {
            ...routeFromRow(row),
            projectId: row.project_id ?? null,
            agentId: row.agent_id ?? null,
          }
        : null
    },

    /** Point lookup for message-thread idempotency. `source_tool_call_id` is indexed
     * by user, while the parent predicate prevents an equal anchor key in another
     * conversation from reopening the wrong thread. */
    async findSessionByParentAndSource(
      userId: string,
      parentSessionId: string,
      sourceToolCallId: string,
    ): Promise<SessionRecord | null> {
      const row = await db
        .selectFrom('agent_sessions')
        .selectAll()
        .where('user_id', '=', userId)
        .where('parent_session_id', '=', parentSessionId)
        .where('source_tool_call_id', '=', sourceToolCallId)
        .executeTakeFirst()
      return row ? mapSession(row) : null
    },

    /**
     * Authoritative parent chain for one session, including the session itself.
     * Nested child creation needs this lineage but not every unrelated user
     * session. The recursive query follows primary-key lookups and is capped at
     * the same depth as the pure resolver, so cycles cannot make SQLite recurse
     * without bound.
     */
    async listSessionAncestry(userId: string, id: string): Promise<SessionRecord[]> {
      // The Bun/SQLite adapter classifies result-producing statements by their
      // leading keyword, so keep SELECT outermost rather than starting with WITH.
      const result = await sql<Parameters<typeof mapSession>[0]>`
        SELECT sessions.*
        FROM agent_sessions AS sessions
        JOIN (
          WITH RECURSIVE ancestry(id, parent_session_id, depth) AS (
            SELECT id, parent_session_id, 0
            FROM agent_sessions
            WHERE user_id = ${userId} AND id = ${id}
            UNION ALL
            SELECT parent.id, parent.parent_session_id, ancestry.depth + 1
            FROM agent_sessions AS parent
            JOIN ancestry ON parent.id = ancestry.parent_session_id
            WHERE parent.user_id = ${userId}
              AND ancestry.depth < ${MAX_SESSION_ANCESTRY_DEPTH}
          )
          SELECT id, depth
          FROM ancestry
        ) AS ancestry ON ancestry.id = sessions.id
        ORDER BY ancestry.depth ASC
      `.execute(db)
      return result.rows.map(mapSession)
    },

    /**
     * Resolve an external conversation through its authoritative identity row.
     * This is the steady-state channel/API path, so it must remain a primary-key
     * point lookup rather than scanning every session's advisory source field.
     */
    async getExternalSession(userId: string, externalKey: string): Promise<SessionRecord | null> {
      const row = await db
        .selectFrom('agent_external_session_keys as identity')
        .innerJoin('agent_sessions as session', 'session.id', 'identity.session_id')
        .selectAll('session')
        .where('identity.user_id', '=', userId)
        .where('identity.external_key', '=', externalKey)
        .where('session.user_id', '=', userId)
        .executeTakeFirst()
      return row ? mapSession(row) : null
    },

    // `listRecentRoutes` — the chain's "what has this person been choosing" level — lives in
    // `repository-recent-routes.ts` and is spread in below.

    /** Ids of direct child sessions (jobs / sub-agents) of the given session. */
    async listChildSessionIds(userId: string, parentId: string): Promise<string[]> {
      const rows = await db
        .selectFrom('agent_sessions')
        .select('id')
        .where('user_id', '=', userId)
        .where('parent_session_id', '=', parentId)
        .execute()
      return rows.map((r) => r.id)
    },
  }
}
