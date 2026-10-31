import { retryUntilDone } from '../lib/retry-until-done'
import { userHome } from '../lib/env'
import { errorMessage } from '../lib/errors'
import type { IdleTask } from '../lib/idle-tasks'
import {
  armPluginAutoUpdate,
  type AutoUpdateTimers,
} from '../features/plugins/auto-update-schedule'
import { createRecommendedPluginInstalls } from '../features/plugins/recommended'
import type { PluginService } from '../features/plugins/service-types'

/**
 * The plugin feature's start-up and background work, armed with the other ops timers:
 *
 * - the auto-update pass — plugins from marketplaces with auto-update on take their newer versions
 *   a random one to ten minutes after start, then every six hours
 *   (`features/plugins/auto-update-schedule.ts`);
 * - the idle task that registers the Store's default marketplaces once
 *   (`features/plugins/default-marketplaces.ts`). It waits on the network, so the caller queues it
 *   near the end;
 * - the idle task after it that installs the plugins Localix's marketplace recommends, once
 *   (`features/plugins/recommended.ts`).
 */
export function armPluginUpdateTimers(deps: {
  pluginService: Pick<PluginService, 'updates' | 'ensureDefaultMarketplaces' | 'install'>
  userId: string
  logger: { info: (entry: object) => void; warn: (entry: object) => void }
  signal: AbortSignal
  /** The marketplaces' listings moved (registered, refreshed): the Store reads them again. */
  onListingsMoved?: () => void
  /** The pass's clock and its random first delay; the system's unless a test hands in its own. */
  schedule?: { timers?: AutoUpdateTimers; random?: () => number }
  /**
   * What Localix's marketplace recommends, as the Store lists it; null while it is unread. Absent:
   * nothing is installed on its own.
   */
  recommended?: () => Promise<{ id: string; installed: boolean }[] | null>
  homeDir?: string
}): { defaultMarketplacesTask: IdleTask; recommendedTask: IdleTask } {
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

  // Offline or failed, it tries again: after five minutes, then twice as long each time, at most
  // every six hours — as the mini apps' pass does (`mini-app-timers.ts`).
  const recommended = deps.recommended
  const pass = recommended
    ? createRecommendedPluginInstalls({
        homeDir: deps.homeDir ?? userHome(),
        recommended,
        install: async (id) => {
          await pluginService.install(deps.userId, { source: id, projectId: null, enable: true })
          deps.onListingsMoved?.()
        },
        log: (event, detail) => logger.warn({ event, ...detail }),
      })
    : null
  const recommendedFailed = (error: unknown) =>
    logger.warn({ event: 'plugins.recommended_failed', error: errorMessage(error) })
  const installRecommended = pass
    ? retryUntilDone({ run: () => pass.run(), onError: recommendedFailed, signal: deps.signal })
    : async () => {}

  return {
    recommendedTask: { name: 'recommended_plugins', run: installRecommended },
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
