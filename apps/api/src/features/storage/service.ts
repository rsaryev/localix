import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { checkpointWal, reclaimFreePages, storageUsage, type StorageUsage } from '../../db/storage'
import { errorMessage } from '../../lib/errors'

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

  const candidates = async (userId: string, olderThanDays: number): Promise<string[]> => {
    const cutoff = new Date(now().getTime() - olderThanDays * 86_400_000).toISOString()
    const rows = await db
      .selectFrom('agent_sessions')
      .select('id')
      .where('user_id', '=', userId)
      .where('parent_session_id', 'is', null)
      .where('is_pinned', '=', 0)
      .where('runtime_status', '<>', 'running')
      .where('last_message_at', '<', cutoff)
      .execute()
    return rows.map((row) => row.id)
  }

  const bytesOf = async (userId: string, roots: readonly string[]): Promise<number> => {
    let bytes = 0
    for (let at = 0; at < roots.length; at += 200) {
      const list = sql.join(roots.slice(at, at + 200))
      const scope = sql`session_id IN (SELECT id FROM agent_sessions WHERE user_id = ${userId} AND (id IN (${list}) OR root_session_id IN (${list})))`
      const messages = await sql<{ n: number | null }>`
        SELECT SUM(LENGTH(payload_json)) AS n FROM agent_messages WHERE ${scope}`.execute(db)
      const outputs = await sql<{ n: number | null }>`
        SELECT SUM(byte_length) AS n FROM tool_output_artifacts WHERE ${scope}`.execute(db)
      bytes += Number(messages.rows[0]?.n ?? 0) + Number(outputs.rows[0]?.n ?? 0)
    }
    return bytes
  }

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
