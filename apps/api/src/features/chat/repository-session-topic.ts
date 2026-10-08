import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { SessionTopic } from '../agent-core/session-topic'
import type { SessionRecord } from './repository-types'

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
    },

    /** One conditional write: a late generator or stale agent cannot replace a newer topic. */
    async updateSessionTopic(
      userId: string,
      id: string,
      expected: Pick<SessionRecord, 'title' | 'goal' | 'previousTopicSummary'>,
      topic: SessionTopic,
      updatedAt: string,
    ): Promise<boolean> {
      const result = await db
        .updateTable('agent_sessions')
        .set({
          title: topic.title,
          goal: topic.goal,
          previous_topic_summary: topic.previousTopicSummary,
          updated_at: updatedAt,
        })
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .where('title', '=', expected.title)
        .where('goal', expected.goal == null ? 'is' : '=', expected.goal ?? null)
        .where(
          'previous_topic_summary',
          expected.previousTopicSummary == null ? 'is' : '=',
          expected.previousTopicSummary ?? null,
        )
        .executeTakeFirst()
      return Number(result.numUpdatedRows) === 1
    },
  }
}
