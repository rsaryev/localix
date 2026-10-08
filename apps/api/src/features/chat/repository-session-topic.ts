import { sql, type Kysely } from 'kysely'
import {
  deserializeMessagePayload,
  mergeMessagePayload,
  retrySqliteBusy,
  serializeMessagePayload,
  type AppDatabase,
} from '../../db'
import { agentParticipant } from '../../db/participant'
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

    /** Commit the shared topic and its history boundary together, or change neither. */
    async updateSessionTopic(
      userId: string,
      id: string,
      expected: Pick<SessionRecord, 'title' | 'goal' | 'previousTopicSummary'>,
      topic: SessionTopic,
      updatedAt: string,
      boundary: { messageId: string; agentId: string },
    ): Promise<boolean> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const host = await trx
            .selectFrom('agent_messages')
            .select('payload_json')
            .where('user_id', '=', userId)
            .where('session_id', '=', id)
            .where('id', '=', boundary.messageId)
            .executeTakeFirst()
          if (!host) return false
          const payload = deserializeMessagePayload(host.payload_json)
          if (payload.role !== 'assistant' || payload.from !== agentParticipant(boundary.agentId))
            return false

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
          await trx
            .updateTable('agent_messages')
            .set({
              payload_json: serializeMessagePayload(
                mergeMessagePayload(payload, { contextBoundary: true }),
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
