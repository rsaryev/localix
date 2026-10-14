import type { Kysely, Transaction } from 'kysely'
import type { AppDatabase } from '../../db'
import { nextRefSeqInTransaction, retrySqliteBusy } from '../../db'
import { sessionRef } from './contracts'
import { mapSession } from './repository-mappers'
import { participantsJsonColumn } from './repository-conversation-participants'
import type { SessionRecord } from './repository-types'

/** The supplied writer must use this transaction for the session and its identity claims. */
export function createExternalSessionWriter(
  db: Kysely<AppDatabase>,
  insertSession: (transaction: Transaction<AppDatabase>, session: SessionRecord) => Promise<void>,
) {
  /**
   * Atomically claim one externally-driven chat per (user, external key).
   * The nullable key row is never committed half-filled: it reserves the key
   * as the transaction's first write, then the same transaction allocates the
   * human ref, inserts the session, and completes the foreign-key link.
   */
  return async function getOrCreateExternalSession(
    userId: string,
    externalKey: string,
    createRecord: (ref: { seq: number; id: string }) => SessionRecord,
  ): Promise<{ session: SessionRecord; created: boolean }> {
    return retrySqliteBusy(() =>
      db.transaction().execute(async (trx) => {
        await trx
          .insertInto('agent_external_session_keys')
          .values({ user_id: userId, external_key: externalKey, session_id: null })
          .onConflict((conflict) => conflict.columns(['user_id', 'external_key']).doNothing())
          .execute()

        const identity = await trx
          .selectFrom('agent_external_session_keys')
          .select('session_id')
          .where('user_id', '=', userId)
          .where('external_key', '=', externalKey)
          .executeTakeFirstOrThrow()
        if (identity.session_id) {
          const existing = await trx
            .selectFrom('agent_sessions')
            .selectAll()
            .select(participantsJsonColumn.as('agents_json'))
            .where('user_id', '=', userId)
            .where('id', '=', identity.session_id)
            .executeTakeFirstOrThrow()
          if (existing.session_kind !== 'chat') {
            throw new Error(`External session identity ${externalKey} does not reference a chat`)
          }
          return { session: mapSession(existing), created: false }
        }

        const seq = await nextRefSeqInTransaction(trx, 'agent_sessions')
        const ref = { seq, id: sessionRef(seq) }
        const session = createRecord(ref)
        if (
          session.id !== ref.id ||
          session.seq !== ref.seq ||
          session.userId !== userId ||
          session.sessionKind !== 'chat' ||
          session.sourceToolCallId !== externalKey
        ) {
          throw new Error('External session factory violated its repository identity contract')
        }
        await insertSession(trx, session)
        const completed = await trx
          .updateTable('agent_external_session_keys')
          .set({ session_id: session.id })
          .where('user_id', '=', userId)
          .where('external_key', '=', externalKey)
          .where('session_id', 'is', null)
          .executeTakeFirst()
        if (Number(completed.numUpdatedRows) !== 1) {
          throw new Error(`Failed to complete external session identity ${externalKey}`)
        }
        return { session, created: true }
      }),
    )
  }
}
