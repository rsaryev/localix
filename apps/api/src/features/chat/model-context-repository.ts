import type { Kysely } from 'kysely'
import type { ContextCheckpoint } from '@localixai/agent'

import type { AppDatabase } from '../../db'
import type { StoredTurnContext } from './runtime/model-view/turn-context'

/**
 * The model's view state, one row per run, keyed by the run's assistant message.
 *
 * Kept apart from the transcript: a message row is shipped to every client, and the turn's
 * runtime context and the frozen checkpoint are the model's alone. The row cascades with its
 * message, so a rollback or a deleted branch takes its view state with it.
 */
export interface ModelContextRow {
  messageId: string
  turnContext?: StoredTurnContext
  hasCheckpoint: boolean
}

export interface ModelContextRepository {
  /** Turn contexts and checkpoint presence for the given messages (unknown ids are absent). */
  list(sessionId: string, messageIds: readonly string[]): Promise<Map<string, ModelContextRow>>
  getCheckpoint(sessionId: string, messageId: string): Promise<ContextCheckpoint | undefined>
  /** Write a run's state. A field left out keeps its stored value; the run is the row's sole author. */
  write(input: {
    sessionId: string
    messageId: string
    turnContext?: StoredTurnContext
    checkpoint?: ContextCheckpoint
    now: string
  }): Promise<void>
}

/** SQLite's host-parameter ceiling is far above this; the chunk keeps one statement small. */
const ID_CHUNK = 500

function parseCheckpoint(json: string): ContextCheckpoint {
  const record = JSON.parse(json) as { version?: unknown }
  // A record this build cannot read must fail the run: projecting it wrongly would change the
  // bytes of an already-sent history without any error.
  if (record.version !== 1)
    throw new Error(`Unsupported checkpoint version ${String(record.version)}`)
  return record as ContextCheckpoint
}

export function createModelContextRepository(db: Kysely<AppDatabase>): ModelContextRepository {
  return {
    async list(sessionId, messageIds) {
      const rows = new Map<string, ModelContextRow>()
      for (let from = 0; from < messageIds.length; from += ID_CHUNK) {
        const chunk = messageIds.slice(from, from + ID_CHUNK)
        const found = await db
          .selectFrom('agent_message_model_context')
          .select(['message_id', 'turn_context_json', 'checkpoint_json'])
          .where('session_id', '=', sessionId)
          .where('message_id', 'in', chunk)
          .execute()
        for (const row of found) {
          rows.set(row.message_id, {
            messageId: row.message_id,
            ...(row.turn_context_json
              ? { turnContext: JSON.parse(row.turn_context_json) as StoredTurnContext }
              : {}),
            hasCheckpoint: row.checkpoint_json !== null,
          })
        }
      }
      return rows
    },

    async getCheckpoint(sessionId, messageId) {
      const row = await db
        .selectFrom('agent_message_model_context')
        .select('checkpoint_json')
        .where('session_id', '=', sessionId)
        .where('message_id', '=', messageId)
        .executeTakeFirst()
      return row?.checkpoint_json ? parseCheckpoint(row.checkpoint_json) : undefined
    },

    async write({ sessionId, messageId, turnContext, checkpoint, now }) {
      const values = {
        ...(turnContext ? { turn_context_json: JSON.stringify(turnContext) } : {}),
        ...(checkpoint ? { checkpoint_json: JSON.stringify(checkpoint) } : {}),
      }
      await db
        .insertInto('agent_message_model_context')
        .values({
          message_id: messageId,
          session_id: sessionId,
          turn_context_json: null,
          checkpoint_json: null,
          ...values,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('message_id').doUpdateSet({ ...values, updated_at: now }))
        .execute()
    },
  }
}
