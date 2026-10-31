import { errorMessage } from '../lib/errors'
import type { IdleTask } from '../lib/idle-tasks'
import { retryUntilDone } from '../lib/retry-until-done'
import type { DomainServicesPhase } from './domain-services'

/**
 * The mini apps feature's start-up and background work, armed with the other ops timers:
 *
 * - marketplace updates of the installed apps, a minute after start and then every six hours
 *   (`features/mini-apps/store.ts`);
 * - the idle task that installs the recommended apps once.
 */
export function armMiniAppTimers(deps: {
  miniAppService: DomainServicesPhase['miniAppService']
  userId: string
  logger: { info: (entry: object) => void; warn: (entry: object) => void }
  signal: AbortSignal
}): { recommendedTask: IdleTask } {
  const { miniAppService, logger, signal } = deps

  // A failed update keeps the version before.
  const updateMiniApps = () =>
    miniAppService.store
      .updateInstalled()
      .then((queued) => {
        if (queued.length) logger.info({ event: 'mini_apps.updates_queued', queued })
      })
      .catch((error) =>
        logger.warn({ event: 'mini_apps.update_check_failed', error: errorMessage(error) }),
      )
  setTimeout(() => void updateMiniApps(), 60_000).unref?.()
  setInterval(() => void updateMiniApps(), 6 * 60 * 60 * 1000).unref?.()

  // The apps the Localix marketplace recommends, installed once on a new installation
  // (`features/mini-apps/recommended.ts`). Offline or failed, it tries again: after five
  // minutes, then twice as long each time, at most every six hours.
  const recommendedFailed = (error: unknown) =>
    logger.warn({ event: 'mini_apps.recommended_failed', error: errorMessage(error) })
  const installRecommended = retryUntilDone({
    run: () => miniAppService.installRecommended(deps.userId),
    onError: recommendedFailed,
    signal,
  })

  return {
    recommendedTask: { name: 'recommended_mini_apps', run: installRecommended },
  }
}
