import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { retrySqliteBusy } from '../../db'
import { asStringArray } from '../../lib/coerce'
import { safeJsonParse } from '../../lib/json'

/**
 * A SESSION'S ACTIVATED TOOLS, CHANGED AS ONE READ-MODIFY-WRITE.
 *
 * Only `ToolSearch` writes the set — the model asking for a tool keeps it — but more than one
 * run can write at once (a turn and a subagent's, a retry). A whole-list `updateSession` lets each
 * write a list computed from what IT read, the record it loaded when it started, so one run's
 * activation erased another's. Here the read and the write share one transaction and the new list
 * is computed from the stored one, so no writer can drop another's names. (Tools an open mini app
 * view or a mini app's wake brings are not stored here at all: `runtime/run/surface-tools.ts`.)
 *
 * The rule itself (order, cap, what counts as a change) stays with its owner,
 * `runtime/run/tool-deferral.ts`; this module only guarantees it is applied to what is stored.
 */
export function createActivatedToolQueries(db: Kysely<AppDatabase>) {
  return {
    /**
     * Apply `change` to the stored set. Answers what `change` answered, or null when the session
     * is not this user's or the change had nothing to write.
     */
    async changeActivatedTools<T extends { next: readonly string[] }>(
      userId: string,
      sessionId: string,
      change: (stored: string[]) => T | null,
    ): Promise<T | null> {
      return retrySqliteBusy(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('agent_sessions')
            .select('activated_tools')
            .where('user_id', '=', userId)
            .where('id', '=', sessionId)
            .executeTakeFirst()
          if (!row) return null
          const changed = change(asStringArray(safeJsonParse(row.activated_tools)))
          if (!changed) return null
          await trx
            .updateTable('agent_sessions')
            .set({ activated_tools: changed.next.length ? JSON.stringify(changed.next) : null })
            .where('user_id', '=', userId)
            .where('id', '=', sessionId)
            .execute()
          return changed
        }),
      )
    },
  }
}
