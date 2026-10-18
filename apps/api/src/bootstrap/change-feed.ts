/**
 * The core change feed in the composition: its consumers' feed (a record failure is reported
 * to the server log), and its upkeep — what every consumer has read is pruned hourly.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createCoreChangeFeed, type CoreChangeFeed } from '../features/changes/core-entities'
import { setChangeLog } from '../features/changes/record'
import type { createLogger } from '../lib/logger'

const PRUNE_EVERY_MS = 60 * 60_000

export function createCoreChanges(
  db: Kysely<AppDatabase>,
  logger: ReturnType<typeof createLogger>,
): CoreChangeFeed {
  const log = (event: string, detail: Record<string, unknown>) => logger.warn({ event, ...detail })
  setChangeLog(log)
  return createCoreChangeFeed(db, log)
}

export function startChangeFeedRetention(feed: CoreChangeFeed, signal?: AbortSignal): void {
  const timer = setInterval(() => void feed.prune().catch(() => {}), PRUNE_EVERY_MS)
  timer.unref?.()
  signal?.addEventListener('abort', () => clearInterval(timer), { once: true })
}
