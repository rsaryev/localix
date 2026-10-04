import type { Kysely, Selectable, Updateable } from 'kysely'

import type { AppDatabase, UserProfilesTable } from '../../db/types'

/** The raw `user_profiles` row (snake_case). Callers map it to domain shapes. */
export type UserProfileRow = Selectable<UserProfilesTable>

/**
 * Single source of truth for `user_profiles` (one row per user, PK = user_id).
 * One atomic UPSERT path so the agent tool and the settings UI never diverge.
 */
export function createUserProfileRepository(db: Kysely<AppDatabase>) {
  return {
    /** The raw profile row, or null when the user has none yet. */
    async getRaw(userId: string): Promise<UserProfileRow | null> {
      const row = await db
        .selectFrom('user_profiles')
        .selectAll()
        .where('user_id', '=', userId)
        .executeTakeFirst()
      return row ?? null
    },

    /** Insert the profile row, or update the given columns on conflict (user_id). */
    async upsert(userId: string, updates: Updateable<UserProfilesTable>): Promise<void> {
      await db
        .insertInto('user_profiles')
        .values({ user_id: userId, ...updates })
        .onConflict((oc) => oc.column('user_id').doUpdateSet(updates))
        .execute()
    },
  }
}

export type UserProfileRepository = ReturnType<typeof createUserProfileRepository>
