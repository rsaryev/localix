import type { Listing } from '@localixai/store'

import { createStoreIndexRepository } from '../index-repository'
import { openStoreIndexDatabase } from '../index-repository-open'
import { cardOf, toIndexRow, toStateRow } from '../index-rows'

export const TEST_NOW = Date.parse('2026-10-25T00:00:00Z')

/** A Store index in memory, and a way to put a source's listings into it. */
export function memoryIndex() {
  const { db, close } = openStoreIndexDatabase(':memory:')
  const repo = createStoreIndexRepository(db)
  return {
    repo,
    close,
    /** Index `listings` as source `sourceId` of their kind, with the person's state for `u1`. */
    put: async (sourceId: string, given: Listing[], userId = 'u1') => {
      const listings = given.map((listing) => ({
        ...listing,
        source: { ...listing.source, id: sourceId },
      }))
      const kind = listings[0]?.ref.kind ?? 'mini-app'
      await repo.replaceSource(
        kind,
        sourceId,
        listings.map((listing) => toIndexRow(cardOf(listing), { now: TEST_NOW })),
        { revision: `r${Math.random()}`, now: new Date(TEST_NOW).toISOString() },
      )
      await repo.markDuplicates()
      await repo.replaceState(
        userId,
        kind,
        listings.flatMap((listing) => toStateRow(listing) ?? []),
      )
    },
  }
}
