import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db/types'
import { recordCoreChanges } from '../changes/core-entities'

/**
 * Whether an installed mini app updates on its own. An app from a catalog signed with the key kept
 * for it does, unless the person switched it off (`docs/internals/plugins-and-mini-apps.md`,
 * "Releasing, installing, updating"); only the switched-off names are kept. Each switch is
 * announced as a `mini-app.updates` notice in its write (C1), and the Store reads again.
 */
export function createMiniAppAutoUpdate(deps: { db: Kysely<AppDatabase> }) {
  return {
    /** The installed apps the person keeps from updating on their own. */
    async off(): Promise<Set<string>> {
      const rows = await deps.db.selectFrom('mini_app_auto_update_off').select('name').execute()
      return new Set(rows.map((row) => row.name))
    },

    async set(name: string, on: boolean): Promise<void> {
      await deps.db.transaction().execute(async (trx) => {
        if (on) await trx.deleteFrom('mini_app_auto_update_off').where('name', '=', name).execute()
        else
          await trx
            .insertInto('mini_app_auto_update_off')
            .values({ name, changed_at: new Date().toISOString() })
            .onConflict((conflict) => conflict.column('name').doNothing())
            .execute()
        await recordCoreChanges(trx, {
          entity: 'mini-app.updates',
          op: 'upserted',
          ref: { id: name },
        })
      })
    },
  }
}

export type MiniAppAutoUpdate = ReturnType<typeof createMiniAppAutoUpdate>
