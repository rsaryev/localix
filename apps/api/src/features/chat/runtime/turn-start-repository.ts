import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../../db/types'

export interface PendingTurnStart {
  assistantMessageId: string
  userId: string
  sessionId: string
  createdAt: string
}

/**
 * The reply slots an acknowledged agent turn ticket recorded (`wake-queue-repository.ts`, `ack`)
 * and whose run never returned. Read and settled once, at boot.
 */
export function createTurnStartRepository(db: Kysely<AppDatabase>) {
  return {
    async listPending(): Promise<PendingTurnStart[]> {
      const rows = await db.selectFrom('agent_turn_starts').selectAll().execute()
      return rows.map((row) => ({
        assistantMessageId: row.assistant_message_id,
        userId: row.user_id,
        sessionId: row.session_id,
        createdAt: row.created_at,
      }))
    },

    /** Whether this agent's run record was opened in the session since the slot was taken. */
    async runStartedSince(start: PendingTurnStart): Promise<boolean> {
      const row = await db
        .selectFrom('agent_runs')
        .select('id')
        .where('session_id', '=', start.sessionId)
        .where('started_at', '>=', start.createdAt)
        .executeTakeFirst()
      return row !== undefined
    },

    async settle(assistantMessageId: string): Promise<void> {
      await db
        .deleteFrom('agent_turn_starts')
        .where('assistant_message_id', '=', assistantMessageId)
        .execute()
    },
  }
}

export type TurnStartRepository = ReturnType<typeof createTurnStartRepository>
