import type { Kysely, Transaction } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { recordCoreChanges } from '../changes/core-entities'

/**
 * Say chats changed (title, status — a run leaving `running` finalizes its last message) or
 * were deleted (their messages with them), in the writer's transaction. Never throws.
 */
export function recordSessionChanges(
  writer: Kysely<AppDatabase> | Transaction<AppDatabase>,
  userId: string,
  ids: readonly string[],
  op: 'upserted' | 'deleted' = 'upserted',
): Promise<void> {
  return recordCoreChanges(
    writer,
    ids.map((id) => ({ entity: 'chat.session' as const, op, ref: { id, userId } })),
  )
}
