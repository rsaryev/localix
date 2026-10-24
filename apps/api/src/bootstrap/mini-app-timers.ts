import { errorMessage } from '../lib/errors'
import { userHome } from '../lib/env'
import type { IdleTask } from '../lib/idle-tasks'
import { bundledMiniAppsSyncRoot } from '../features/mini-apps/discovery'
import {
  bundledStagingFailures,
  invalidateBundledSync,
  syncBundledMiniApps,
} from '../features/mini-apps/bundled-install'
import { watchStagedMiniAppsRoot } from '../features/mini-apps/bundled-watch'
import type { DomainServicesPhase } from './domain-services'
import type { MiniAppHostsPhase } from './mini-app-hosts'

/**
 * The mini apps feature's start-up and background work, armed with the other ops timers:
 *
 * - the staged root's watcher: bundled mini apps re-staged while this process runs (a scaffold, a
 *   backend save in the dev workspace, an app update that lands a new staged root) announce
 *   themselves through its marker, so the catalog and the hosts converge without
 *   `/mini-app reload`;
 * - catalog updates of the installed apps, a minute after start and then every six hours
 *   (`features/mini-apps/store.ts`);
 * - the idle tasks that report staging failures and install the recommended apps once.
 */
export function armMiniAppTimers(deps: {
  miniAppService: DomainServicesPhase['miniAppService']
  miniAppConditions: MiniAppHostsPhase['miniAppConditions']
  userId: string
  logger: { info: (entry: object) => void; warn: (entry: object) => void }
  signal: AbortSignal
}): { stagingReportTask: IdleTask; recommendedTask: IdleTask } {
  const { miniAppService, miniAppConditions, logger, signal } = deps

  // A mini app whose source did not build or install is raised as a condition, each time the
  // staged root settles: after a sync, so a copy that failed in THIS pass is in the report.
  const reportStagingFailures = (root: string) =>
    syncBundledMiniApps(root, userHome())
      .then(() => bundledStagingFailures(root, userHome()))
      .then((failures) => miniAppConditions.stagingFailed(failures))
      .catch((error) =>
        logger.warn({ event: 'mini_apps.staging_report_failed', error: errorMessage(error) }),
      )
  // Forget the sync memo and record a `mini-app` resync on a re-stage. Armed at once — a re-stage
  // during the idle wait must not go unseen.
  const stagedRoot = bundledMiniAppsSyncRoot()
  void stagedRoot.then((root) => {
    if (!root || signal.aborted) return
    const watcher = watchStagedMiniAppsRoot({
      root,
      onChange: () => {
        invalidateBundledSync()
        void miniAppService.resync()
        logger.info({ event: 'mini_apps.staged_root_changed', root })
        void reportStagingFailures(root)
      },
      log: (msg) => logger.warn({ event: 'mini_apps.staged_root_watch', msg }),
    })
    if (watcher) {
      logger.info({ event: 'mini_apps.staged_root_watching', root })
      signal.addEventListener('abort', () => watcher.close(), { once: true })
    }
  })

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

  // The apps the Localix catalog recommends, installed once on a new installation
  // (`features/mini-apps/recommended.ts`). Offline or failed, it tries again: after five
  // minutes, then twice as long each time, at most every six hours.
  let recommendedRetryMs = 5 * 60_000
  const installRecommended = (): Promise<void> =>
    miniAppService
      .installRecommended(deps.userId)
      .catch((error) => {
        logger.warn({ event: 'mini_apps.recommended_failed', error: errorMessage(error) })
        return 'retry' as const
      })
      .then((outcome) => {
        if (outcome === 'done' || signal.aborted) return
        setTimeout(() => void installRecommended(), recommendedRetryMs).unref?.()
        recommendedRetryMs = Math.min(recommendedRetryMs * 2, 6 * 60 * 60 * 1000)
      })

  return {
    stagingReportTask: {
      name: 'staging_report',
      run: () => stagedRoot.then((root) => (root ? reportStagingFailures(root) : undefined)),
    },
    recommendedTask: { name: 'recommended_mini_apps', run: installRecommended },
  }
}
