import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'

/**
 * The newest untouched root chat in a project that a landing may reopen instead of minting
 * another "New Chat".
 *
 * Untouched means nothing a person could lose: no stored message, never renamed, pinned or
 * archived, not running, not linked to an external CLI, and exactly one participant — the one
 * the caller is about to start with. A chat that fails any of these is someone's work.
 */
export function createEmptyDraftQueries(db: Kysely<AppDatabase>) {
  return {
    async findEmptyDraft(
      userId: string,
      projectId: string,
      agentId: string,
      defaultTitle: string,
    ): Promise<string | null> {
      const row = await db
        .selectFrom('agent_sessions as s')
        .select('s.id')
        .where('s.user_id', '=', userId)
        .where('s.project_id', '=', projectId)
        .where('s.session_kind', '=', 'chat')
        .where('s.parent_session_id', 'is', null)
        .where('s.archived_at', 'is', null)
        .where('s.is_pinned', '=', 0)
        .where('s.runtime_status', '=', 'idle')
        .where('s.external_agent_provider', 'is', null)
        .where('s.title', '=', defaultTitle)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('agent_messages as m')
                .select('m.id')
                .whereRef('m.session_id', '=', 's.id'),
            ),
          ),
        )
        .where(
          (eb) =>
            eb
              .selectFrom('conversation_participants as p')
              .select((inner) => inner.fn.countAll<number>().as('n'))
              .whereRef('p.session_id', '=', 's.id'),
          '=',
          1,
        )
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('conversation_participants as p')
              .select('p.session_id')
              .whereRef('p.session_id', '=', 's.id')
              .where('p.agent_id', '=', agentId),
          ),
        )
        .orderBy('s.created_at', 'desc')
        .orderBy('s.seq', 'desc')
        .limit(1)
        .executeTakeFirst()
      return row?.id ?? null
    },
  }
}
