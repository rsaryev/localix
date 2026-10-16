import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { PersistedMessage } from './contracts'
import { mapMessage } from './repository-mappers'
import type { SessionLeafOps } from './repository-tree'
import { createMessageParseCache } from './message-parse-cache'
import { createMessageBranchQueries } from './repository-message-branches'
import { createMessageProjectionQueries } from './repository-message-projections'
import { createMessageWriteQueries } from './repository-message-writes'

/** Message queries share one leaf controller and one parse cache per repository instance. */
export function createMessageQueries(db: Kysely<AppDatabase>, leaf: SessionLeafOps) {
  const cache = createMessageParseCache()
  return {
    ...createMessageBranchQueries(db, leaf, cache),
    ...createMessageProjectionQueries(db, leaf),
    async getMessage(
      userId: string,
      sessionId: string,
      id: string,
    ): Promise<PersistedMessage | null> {
      const row = await db
        .selectFrom('agent_messages')
        .selectAll()
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .where('id', '=', id)
        .executeTakeFirst()

      return row ? mapMessage(row) : null
    },

    ...createMessageWriteQueries(db, leaf, cache),
  }
}
