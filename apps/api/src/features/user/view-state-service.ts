import { NotFoundError } from '../../lib/domain-errors'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import {
  viewStateAddressSchema,
  viewStateWriteSchema,
  type ViewStateAddress,
  type ViewStateSnapshot,
  type ViewStateWrite,
  type ViewStateWriteResult,
} from './view-state-contracts'

/** Typed, user-scoped resume state. Domain settings and runtime data retain their own APIs. */
export function createViewStateService(db: Kysely<AppDatabase>, now: () => string) {
  const serialize = createKeyedSerializer()
  const getViewState = async (
    userId: string,
    address: ViewStateAddress,
  ): Promise<ViewStateSnapshot> => {
    const checked = viewStateAddressSchema.parse(address)
    const row = await db
      .selectFrom('user_view_state')
      .selectAll()
      .where('user_id', '=', userId)
      .where('kind', '=', checked.kind)
      .where('key', '=', checked.key)
      .executeTakeFirst()
    return {
      ...checked,
      revision: row?.revision ?? 0,
      value: row ? JSON.parse(row.value_json) : null,
      updatedAt: row?.updated_at ?? null,
    }
  }
  const writeViewState = async (
    userId: string,
    input: ViewStateWrite,
  ): Promise<ViewStateWriteResult> => {
    const patch = viewStateWriteSchema.parse(input)
    return serialize(JSON.stringify([userId, patch.kind, patch.key]), async () => {
      const current = await getViewState(userId, patch)
      if (current.revision !== patch.expectedRevision) return { accepted: false, state: current }
      const sessionId = patch.kind === 'draft' ? patch.key : patch.value?.sessionId
      if (sessionId) {
        const session = await db
          .selectFrom('agent_sessions')
          .select('id')
          .where('id', '=', sessionId)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!session)
          throw new NotFoundError(
            'view_state_session_not_found',
            'This conversation is no longer available.',
          )
      }
      const row = {
        value_json: JSON.stringify(patch.value),
        revision: current.revision + 1,
        updated_at: now(),
      }
      // The compare also lives in SQL: independent callers/processes cannot overwrite a newer row.
      const saved =
        current.revision === 0
          ? await db
              .insertInto('user_view_state')
              .values({ user_id: userId, kind: patch.kind, key: patch.key, ...row })
              .onConflict((conflict) => conflict.columns(['user_id', 'kind', 'key']).doNothing())
              .returning('revision')
              .executeTakeFirst()
          : await db
              .updateTable('user_view_state')
              .set(row)
              .where('user_id', '=', userId)
              .where('kind', '=', patch.kind)
              .where('key', '=', patch.key)
              .where('revision', '=', current.revision)
              .returning('revision')
              .executeTakeFirst()
      return {
        accepted: Boolean(saved),
        state: saved
          ? {
              kind: patch.kind,
              key: patch.key,
              value: patch.value,
              revision: saved.revision,
              updatedAt: row.updated_at,
            }
          : await getViewState(userId, patch),
      }
    })
  }
  return { getViewState, writeViewState }
}
