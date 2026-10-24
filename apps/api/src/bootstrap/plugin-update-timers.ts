import { errorMessage } from '../lib/errors'
import type { IdleTask } from '../lib/idle-tasks'
import {
  armPluginAutoUpdate,
  type AutoUpdateTimers,
} from '../features/plugins/auto-update-schedule'
import type { PluginService } from '../features/plugins/service-types'

/**
 * The plugin feature's start-up and background work, armed with the other ops timers:
 *
 * - the auto-update pass — plugins from marketplaces with auto-update on take their newer versions
 *   a random one to ten minutes after start, then every six hours
 *   (`features/plugins/auto-update-schedule.ts`);
 * - the idle task that registers the Store's default marketplaces once
 *   (`features/plugins/default-marketplaces.ts`). It waits on the network, so the caller queues it
 *   near the end.
 */
export function armPluginUpdateTimers(deps: {
  pluginService: Pick<PluginService, 'updates' | 'ensureDefaultMarketplaces'>
  userId: string
  logger: { info: (entry: object) => void; warn: (entry: object) => void }
  signal: AbortSignal
  /** The marketplaces' listings moved (registered, refreshed): the Store reads them again. */
  onListingsMoved?: () => void
  /** The pass's clock and its random first delay; the system's unless a test hands in its own. */
  schedule?: { timers?: AutoUpdateTimers; random?: () => number }
}): { defaultMarketplacesTask: IdleTask } {
  const { pluginService, logger } = deps
  const stop = armPluginAutoUpdate({
    ...deps.schedule,
    run: () =>
      pluginService.updates
        .autoUpdatePass(deps.userId)
        .then((outcome) => {
          if (outcome.refreshed.length) deps.onListingsMoved?.()
          if (outcome.updated.length || outcome.failed.length)
            logger.info({ event: 'plugins.auto_update', ...outcome })
        })
        .catch((error) =>
          logger.warn({ event: 'plugins.auto_update_failed', error: errorMessage(error) }),
        ),
  })
  deps.signal.addEventListener('abort', stop, { once: true })
  return {
    defaultMarketplacesTask: {
      name: 'default_plugin_marketplaces',
      run: () =>
        pluginService
          .ensureDefaultMarketplaces()
          .then((outcomes) => {
            logger.info({ event: 'plugins.default_marketplaces', outcomes })
            deps.onListingsMoved?.()
          })
          .catch((error) =>
            logger.warn({
              event: 'plugins.default_marketplaces_failed',
              error: errorMessage(error),
            }),
          ),
    },
  }
}
