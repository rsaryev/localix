import { errorMessage } from '../lib/errors'
import type { IdleTask } from '../lib/idle-tasks'
import { armPluginAutoUpdate } from '../features/plugins/auto-update-schedule'
import type { PluginService } from '../features/plugins/service-types'

/**
 * The plugin feature's start-up and background work, armed with the other ops timers:
 *
 * - the auto-update pass — plugins from marketplaces with auto-update on take their newer versions
 *   a random one to ten minutes after start, then every six hours
 *   (`features/plugins/auto-update-schedule.ts`);
 * - the idle task that registers the official `localix` marketplace once
 *   (`features/plugins/official-marketplace.ts`). It waits on the network, so the caller queues it
 *   near the end.
 */
export function armPluginUpdateTimers(deps: {
  pluginService: Pick<PluginService, 'updates' | 'ensureOfficialMarketplace'>
  userId: string
  logger: { info: (entry: object) => void; warn: (entry: object) => void }
  signal: AbortSignal
}): { officialMarketplaceTask: IdleTask } {
  const { pluginService, logger } = deps
  const stop = armPluginAutoUpdate({
    run: () =>
      pluginService.updates
        .autoUpdatePass(deps.userId)
        .then((outcome) => {
          if (outcome.updated.length || outcome.failed.length)
            logger.info({ event: 'plugins.auto_update', ...outcome })
        })
        .catch((error) =>
          logger.warn({ event: 'plugins.auto_update_failed', error: errorMessage(error) }),
        ),
  })
  deps.signal.addEventListener('abort', stop, { once: true })
  return {
    officialMarketplaceTask: {
      name: 'official_plugin_marketplace',
      run: () =>
        pluginService
          .ensureOfficialMarketplace()
          .then((outcome) => logger.info({ event: 'plugins.official_marketplace', ...outcome }))
          .catch((error) =>
            logger.warn({
              event: 'plugins.official_marketplace_failed',
              error: errorMessage(error),
            }),
          ),
    },
  }
}
