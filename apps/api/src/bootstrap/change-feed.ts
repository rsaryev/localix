/**
 * The change feeds in the composition: the core's (a record failure reported to the server log)
 * and every plugin's own (`host.changes`), with their upkeep — what every consumer has read is
 * pruned hourly — and their shutdown.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { createCoreChangeFeed } from '../features/changes/core-entities'
import { createMiniAppChangeHosts } from '../features/changes/plugin-host'
import { setChangeLog } from '@localixai/change-feed'
import type { createLogger } from '../lib/logger'

const PRUNE_EVERY_MS = 60 * 60_000

export function createChangeFeeds(
  db: Kysely<AppDatabase>,
  logger: ReturnType<typeof createLogger>,
) {
  const log = (event: string, detail: Record<string, unknown>) => logger.warn({ event, ...detail })
  setChangeLog(log)
  const core = createCoreChangeFeed(db, log)
  const plugins = createMiniAppChangeHosts({ db, core, log })
  return {
    core,
    plugins,
    async close() {
      await plugins.close()
      await core.close()
    },
  }
}

export type ChangeFeeds = ReturnType<typeof createChangeFeeds>

export function startChangeFeedRetention(feeds: ChangeFeeds, signal?: AbortSignal): void {
  const prune = async () => {
    await feeds.core.prune()
    await feeds.plugins.prune()
  }
  const timer = setInterval(() => void prune().catch(() => {}), PRUNE_EVERY_MS)
  timer.unref?.()
  signal?.addEventListener('abort', () => clearInterval(timer), { once: true })
}
