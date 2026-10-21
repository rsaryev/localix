import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { checkpointWal, reclaimFreePages, storageUsage, type StorageUsage } from '../../db/storage'
import { errorMessage } from '../../lib/errors'
import { createStorageRepository } from './repository'

export const MIN_PRUNE_DAYS = 7

export interface PruneResult {
  /** Conversations (root sessions) older than the cutoff that are, or were, removed. */
  sessions: number
  /** What they hold: message and tool-output bytes, before any compression. */
  bytes: number
  /** Present when the call only counted. */
  dryRun: boolean
  /** Sessions that could not be deleted (the rest were). */
  failed: number
}

export interface StorageService {
  usage(): Promise<StorageUsage>
  /**
   * Delete whole conversations that have had no message for `olderThanDays`. Pinned and running
   * ones are never touched, and a conversation goes with its sub-agent sessions, so no tool call is
   * ever separated from its result. With `dryRun` it only counts.
   */
  pruneOlderThan(
    userId: string,
    options: { olderThanDays: number; dryRun: boolean },
  ): Promise<PruneResult>
}

export function createStorageService(deps: {
  db: Kysely<AppDatabase>
  deleteSession: (userId: string, id: string) => Promise<void>
  warn?: (message: string) => void
  now?: () => Date
}): StorageService {
  const { db, deleteSession } = deps
  const now = deps.now ?? (() => new Date())

  const store = createStorageRepository(db)
  const candidates = (userId: string, olderThanDays: number): Promise<string[]> =>
    store.pruneCandidates(
      userId,
      new Date(now().getTime() - olderThanDays * 86_400_000).toISOString(),
    )
  const bytesOf = (userId: string, roots: readonly string[]) => store.bytesOf(userId, roots)

  return {
    usage: () => storageUsage(db),
    async pruneOlderThan(userId, { olderThanDays, dryRun }) {
      const days = Math.max(MIN_PRUNE_DAYS, Math.floor(olderThanDays))
      const roots = await candidates(userId, days)
      const bytes = await bytesOf(userId, roots)
      if (dryRun || roots.length === 0) return { sessions: roots.length, bytes, dryRun, failed: 0 }
      let failed = 0
      for (const id of roots) {
        try {
          await deleteSession(userId, id)
        } catch (error) {
          failed += 1
          deps.warn?.(`could not delete session ${id}: ${errorMessage(error)}`)
        }
      }
      // Hand the freed pages back and fold the log in, so the file shrinks now and not at the
      // next daily pass.
      await reclaimFreePages(db, 1_000_000).catch(() => {})
      await checkpointWal(db).catch(() => {})
      return { sessions: roots.length - failed, bytes, dryRun, failed }
    },
  }
}
