import type { Kysely, Selectable } from 'kysely'
import type { AppDatabase } from '../../db'
import { routeFromRow } from './repository-session-agent'

type ChatProjectionRow = Pick<
  Selectable<AppDatabase['agent_sessions']>,
  'id' | 'title' | 'project_id' | 'runtime_status' | 'updated_at'
> &
  Parameters<typeof routeFromRow>[0] & { agent_id: string | null }

function chatProjectionQuery(db: Kysely<AppDatabase>) {
  return db
    .selectFrom('agent_sessions')
    .select([
      'agent_sessions.id',
      'agent_sessions.title',
      'agent_sessions.project_id',
      'agent_sessions.runtime_status',
      'agent_sessions.agent_id',
      'agent_sessions.model_id',
      'agent_sessions.reasoning_effort',
      'agent_sessions.updated_at',
      'agent_sessions.provider_connection_id',
    ])
}

function mapChatProjection(row: ChatProjectionRow) {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id ?? null,
    agentId: row.agent_id ?? null,
    runtimeStatus: row.runtime_status ?? 'idle',
    ...routeFromRow(row),
    updatedAt: row.updated_at,
    sessionKind: 'chat' as const,
  }
}

export function createChatProjectionQueries(db: Kysely<AppDatabase>) {
  return {
    /**
     * Narrow, bounded roster for plugin channel management. Unlike the UI list,
     * this surface neither needs message counts nor wide session/runtime state;
     * apply chat/project filters and LIMIT before rows leave SQLite.
     */
    async listRecentChatSessions(
      userId: string,
      opts?: { projectId?: string | null; limit?: number },
    ) {
      const requestedLimit = opts?.limit ?? 20
      const limit =
        Number.isSafeInteger(requestedLimit) && requestedLimit >= 0 ? requestedLimit : 20
      let query = chatProjectionQuery(db)
        .where('agent_sessions.user_id', '=', userId)
        .where('agent_sessions.session_kind', '=', 'chat')
      if (opts?.projectId === null) {
        query = query.where('agent_sessions.project_id', 'is', null)
      } else if (opts?.projectId !== undefined) {
        query = query.where('agent_sessions.project_id', '=', opts.projectId)
      }
      const rows = await query
        .orderBy('is_pinned', 'desc')
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .execute()
      return rows.map(mapChatProjection)
    },

    /**
     * Channel workspace actions repeatedly validate one regular chat before a
     * mutation, usage read, stop, or HITL response. Filter and project that
     * identity in SQLite instead of hydrating SessionDetail and its transcript.
     */
    async getChatSessionProjection(userId: string, id: string) {
      const row = await chatProjectionQuery(db)
        .where('agent_sessions.user_id', '=', userId)
        .where('agent_sessions.id', '=', id)
        .where('agent_sessions.session_kind', '=', 'chat')
        .executeTakeFirst()
      return row ? mapChatProjection(row) : null
    },
  }
}
