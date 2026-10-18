import { sql, type Kysely } from 'kysely'
import {
  deserializeMessagePayload,
  mergeMessagePayload,
  retrySqliteBusy,
  serializeMessagePayload,
  type AppDatabase,
} from '../../db'
import type { SessionTopic } from '../agent-core/session-topic'
import type { SessionRecord } from './repository-types'
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

    /** Commit the shared topic and its history boundary together, or change neither. */
    async updateSessionTopic(
      userId: string,
      id: string,
      expected: Pick<SessionRecord, 'title' | 'goal' | 'previousTopicSummary'>,
      topic: SessionTopic,
      updatedAt: string,
      /**
       * The last row of the previous topic: the history the next runs read starts after it. Absent
       * when the request that opens the topic is the conversation's first message.
       */
      boundary?: { messageId: string },
    ): Promise<boolean> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const host = boundary
            ? await trx
                .selectFrom('agent_messages')
                .select('payload_json')
                .where('user_id', '=', userId)
                .where('session_id', '=', id)
                .where('id', '=', boundary.messageId)
                .executeTakeFirst()
            : undefined
          if (boundary && !host) return false

          const result = await trx
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
          if (Number(result.numUpdatedRows) !== 1) return false
          await recordSessionChanges(trx, userId, [id])
          if (!boundary || !host) return true
          await trx
            .updateTable('agent_messages')
            .set({
              payload_json: serializeMessagePayload(
                mergeMessagePayload(deserializeMessagePayload(host.payload_json), {
                  contextBoundary: true,
                }),
              ),
              updated_at: updatedAt,
            })
            .where('user_id', '=', userId)
            .where('session_id', '=', id)
            .where('id', '=', boundary.messageId)
            .execute()
          return true
        }),
      )
    },
  }
}
