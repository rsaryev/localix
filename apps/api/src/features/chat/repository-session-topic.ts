import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import { recordSessionChanges } from './session-changes'

export function createSessionTopicQueries(db: Kysely<AppDatabase>) {
  return {
    /** First-message fallback, without overwriting an objective or title changed in parallel. */
    async seedSessionTopic(
      userId: string,
      id: string,
      fallbackTitle: string,
      goal: string | null,
    ): Promise<void> {
      await db
        .updateTable('agent_sessions')
        .set({
          title: sql<string>`CASE WHEN title = 'New Chat' THEN ${fallbackTitle} ELSE title END`,
          goal: sql<string | null>`COALESCE(goal, ${goal})`,
        })
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .execute()
      await recordSessionChanges(db, userId, [id])
    },
  }
}
