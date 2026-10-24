import { errorMessage } from '../lib/errors'
import { resolveDefaultUserId, userHome } from '../lib/env'
import { createMiniAppChannelHost } from '../features/mini-apps/channel-host'
import { createChannelWorkspace } from '../features/mini-apps/channel-workspace'
import { createPluginMonitorHost } from '../features/plugins/monitor-host'
import {
  createPluginConditions,
  observePluginConditions,
} from '../features/notifications/conditions/plugins'
import { setSessionActivityListener } from '../features/agent-core/session-activity'
import { setSkillInvocationListener } from '../features/agent-core/skill-invocations'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../features/capabilities/availability'
import { runIdleTasks, type IdleTask } from '../lib/idle-tasks'
import type { InfraPhase } from './infra'
import type { DomainServicesPhase } from './domain-services'
import type { MiniAppHostRefs } from './mini-app-host-refs'
import type { MiniAppHostsPhase } from './mini-app-hosts'
import type { createChatService } from '../features/chat/service'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { retireLegacyPluginCopies } from '../features/mini-apps/legacy-plugin-copies'
import { recoverDelegationReports } from '../features/chat/service/recover-delegation'
import { MINI_APP_WARNINGS, warnOnce } from '../lib/warn-once'
import type { StorageMaintenance } from './storage-maintenance'
import { armModelCatalogChecks } from '../features/catalog/refresh-schedule'
import { armPluginUpdateTimers } from './plugin-update-timers'
import { armMiniAppTimers } from './mini-app-timers'
import { sessionDataSweepTask } from './session-data-sweep'

export interface OpsTimersPhaseInput
  extends
    Pick<
      InfraPhase,
      'db' | 'env' | 'logger' | 'catalogService' | 'providerConnectionsService' | 'notifications'
    >,
    Pick<
      DomainServicesPhase,
      'projectsService' | 'skillsCuratorService' | 'pluginService' | 'miniAppService'
    > {
  chatService: ReturnType<typeof createChatService>
  maintainStorage: StorageMaintenance
  hostRefs: MiniAppHostRefs
  miniAppConditions: MiniAppHostsPhase['miniAppConditions']
}

export interface OpsTimersPhase {
  channelHost: ReturnType<typeof createMiniAppChannelHost>
  monitorHost: ReturnType<typeof createPluginMonitorHost>
  startOpsTimers: (signal?: AbortSignal) => void
  warmStartupCaches: () => void
}

export function createOpsTimersPhase({
  db,
  env,
  logger,
  catalogService,
  providerConnectionsService,
  projectsService,
  skillsCuratorService,
  pluginService,
  miniAppService,
  chatService,
  maintainStorage,
  hostRefs,
  notifications,
  miniAppConditions,
}: OpsTimersPhaseInput): OpsTimersPhase {
  const warnMiniAppOnce = warnOnce(logger, MINI_APP_WARNINGS)
  // What is wrong with a Claude Code plugin (its load, its monitors), as Event Center conditions.
  // The per-run plugin load is built inside the chat runtime, out of reach: observed here.
  const pluginConditions = createPluginConditions(notifications, env.LOCALIX_DEFAULT_USER_ID)
  observePluginConditions(pluginConditions)
  // Mini app channels: long-running platform bridges contributed by
  // enabled mini apps. Inbound messages run a full agent turn in a persistent
  // chat session; the final reply is returned to the platform by the mini app.
  // `workspace` gives channels the same management surface the UI sidebar has
  // (list/create/switch/stop sessions, projects, models) — see ChannelWorkspaceApi.
  const channelUserId = env.LOCALIX_DEFAULT_USER_ID
  const channelWorkspace = createChannelWorkspace({
    userId: channelUserId,
    chatService,
    projectsService,
    catalogService,
    providerConnectionsService,
  })
  const channelHost = createMiniAppChannelHost({
    homeDir: userHome(),
    repo: createCapabilitySourceRepository(db, 'mini-app'),
    availabilityFor: (userId) => readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
    userId: channelUserId,
    inbound: ({ app, channelName, message }) =>
      chatService.handleChannelInbound(channelUserId, { app, channelName, message }),
    workspace: channelWorkspace,
    conditions: miniAppConditions,
    logger: {
      info: (msg) => logger.info({ event: 'mini_app_channel.info', msg }),
      warn: (msg, meta) => warnMiniAppOnce({ event: 'mini_app_channel.warn', msg, meta }),
    },
  })
  hostRefs.channelHost = channelHost

  // Plugin background monitors (CC `monitors`, experimental): long-running commands
  // from enabled plugins whose stdout lines surface to the model as notifications,
  // through the one wake delivery. A line wakes ONLY the sessions the plugin armed the
  // monitor for (its `monitors` host service): each line used to wake every root chat of
  // the user, because nothing named the conversation a watcher was for. A line nobody
  // armed reaches nobody and is logged as undelivered. A BUSY armed session is woken too —
  // the wake queue holds it, and one monitor's lines waiting together are one turn. A session
  // that can no longer take a wake (deleted, not a chat) is disarmed on its first miss, so
  // the miss is logged once rather than per line. Provenance 'external' reuses the existing
  // wake source (documented as "another agent, CI, a monitor").
  const monitorHost = createPluginMonitorHost({
    homeDir: userHome(),
    repo: createCapabilitySourceRepository(db, 'plugin'),
    availabilityFor: (userId) => readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
    userId: channelUserId,
    deliver: (note) => {
      const coalesce = `monitor:${note.pluginName}/${note.monitorName}`
      const content = `[${coalesce}] ${note.line}`
      for (const sessionId of note.sessionIds)
        hostRefs.wakes!.send(
          { userId: channelUserId, sessionId, content, source: 'external', coalesce },
          `plugin monitor ${note.pluginName}/${note.monitorName}`,
          (outcome) => {
            if (outcome.status === 'missed') monitorHost.disarmSession(sessionId)
          },
        )
    },
    unaddressed: (note) =>
      hostRefs.wakes!.unaddressed(
        `plugin monitor ${note.pluginName}/${note.monitorName} (armed for no session)`,
        'external',
      ),
    conditions: pluginConditions,
    logger: {
      info: (msg) => logger.info({ event: 'plugin_monitor.info', msg }),
      warn: (msg, meta) => logger.warn({ event: 'plugin_monitor.warn', msg, meta }),
    },
  })
  hostRefs.monitorHost = monitorHost
  // A skill that ran in a chat starts the plugin monitors waiting for it (`on-skill-invoke`).
  setSkillInvocationListener((invocation) =>
    monitorHost
      .skillInvoked(invocation)
      .catch((error) => logger.warn({ event: 'plugin_monitor.warn', msg: errorMessage(error) })),
  )
  // A chat that runs hears the plugins' `always` monitors, from its own working directory.
  setSessionActivityListener((activity) =>
    monitorHost
      .sessionActive(activity)
      .catch((error) => logger.warn({ event: 'plugin_monitor.warn', msg: errorMessage(error) })),
  )

  const startOpsTimers = (signal: AbortSignal = new AbortController().signal): void => {
    // Once, at startup: a report whose live delivery a dead process never finished.
    const recoverReports = async () => {
      try {
        // Every user's children, not only the default user's: a report owed to anyone else
        // would otherwise never be recovered.
        await recoverDelegationReports(db, (request) => chatService.wakeSession(request))
      } catch (error) {
        logger.warn({ event: 'delegation.recovery_failed', error: errorMessage(error) })
      }
    }

    // Bundled mini apps' staged root, catalog updates and recommended installs.
    const miniAppTimers = armMiniAppTimers({
      miniAppService,
      miniAppConditions,
      userId: env.LOCALIX_DEFAULT_USER_ID,
      logger,
      signal,
    })

    setInterval(() => void maintainStorage(signal), 24 * 60 * 60 * 1000).unref?.()

    // Opportunistic curator cadence: check once idle after startup, then once a day. The marker
    // file (~/.localix/curator-state.json) guarantees at most one real pass per
    // 7 days; the very first observation only seeds the marker (first-run defer).
    const runCuratorCheck = () =>
      skillsCuratorService.maybeRunScheduled(env.LOCALIX_DEFAULT_USER_ID).catch((err) => {
        logger.warn({ event: 'skills_curator.scheduled_error', error: String(err) })
      })
    setInterval(() => void runCuratorCheck(), 24 * 60 * 60 * 1000).unref?.()

    // Plugin auto-update and the official marketplace (`plugin-update-timers.ts`).
    const pluginTimers = armPluginUpdateTimers({
      pluginService,
      userId: env.LOCALIX_DEFAULT_USER_ID,
      logger,
      signal,
    })

    // Model lists: hourly, refetched past six hours (`features/catalog/refresh-schedule.ts`).
    const checkModelCatalog = armModelCatalogChecks({ catalogService, signal, logger })
    // Everything above only ARMS a cadence. The first run of each job waits for the idle
    // scheduler (`lib/idle-tasks.ts`, which names the stall this prevents), one job at a time.
    // None of them is read by a first request: owed reports are already 30 s past their live
    // path (`recover-delegation.ts`), canonical session usage reads the messages rather than
    // the ledger the reconcile repairs, and a plugin bridge or monitor starting a second later
    // is invisible — while `signal` (shutdown) keeps a host from starting after its stop.
    const idleTasks: IdleTask[] = [
      { name: 'mini_app_channels', run: () => channelHost.start() },
      { name: 'plugin_monitors', run: () => monitorHost.start() },
      miniAppTimers.stagingReportTask,
      { name: 'delegation_recovery', run: recoverReports },
      sessionDataSweepTask(db, logger),
      { name: 'skills_curator', run: runCuratorCheck },
      { name: 'storage_maintenance', run: (ctx) => maintainStorage(signal, ctx) },
      miniAppTimers.recommendedTask,
      // Near the end: it waits on the network (a first fetch of the official marketplace).
      pluginTimers.officialMarketplaceTask,
      // Last: it waits on the network, and the restored catalog is already served.
      ...(checkModelCatalog ? [{ name: 'model_catalog_check', run: checkModelCatalog }] : []),
    ]
    void runIdleTasks(idleTasks, {
      signal,
      onTaskDone: (task, ms, error) =>
        logger.info({
          event: 'startup.idle_tasks',
          task,
          ms: Math.round(ms),
          ...(error ? { error: errorMessage(error) } : {}),
        }),
    })

    // Notification journal retention (`features/notifications/retention.ts`): once shortly after
    // boot and then daily, so an inbox left alone for a year holds at most its cap, not a year.
    const pruneNotifications = () => {
      notifications.prune().catch((err) => {
        logger.warn({ event: 'notifications.prune_failed', error: String(err) })
      })
    }
    setTimeout(pruneNotifications, 60_000).unref?.()
    setInterval(pruneNotifications, 24 * 60 * 60 * 1000).unref?.()
  }

  /**
   * Pay for plugin discovery before a client has to.
   *
   * `GET /rpc/capabilities/snapshot` and `GET /rpc/tools/gc` both resolve plugin
   * contributions, and the first caller after boot funds the content-hash of the whole
   * plugin directory. Measured on a packaged launch that is ~1.2s, and the client pays it
   * — it is the single largest span between the workspace appearing and the activity rail
   * being complete, and it lands as a visible fill-in.
   *
   * Called AFTER the server is listening, never before: moving it ahead of readiness would
   * just relabel the same second as startup time and delay the window. Failures are
   * irrelevant here — this is a cache warm, and the real request will surface any problem
   * with its own error handling.
   */
  const warmStartupCaches = (): void => {
    const userId = resolveDefaultUserId()
    // The managed mini app copies earlier builds kept among the plugins go first, then plain-text
    // secrets an older build stored move to the vault (`plugins/service-config.ts`).
    void retireLegacyPluginCopies(userHome())
      .then((removed) => {
        if (removed.length) logger.info({ event: 'mini_apps.legacy_copies_removed', removed })
      })
      .catch(() => {})
      .then(() => pluginService.reconcileStoredConfig(userId))
      .then(() => pluginService.listPlugins(userId, { projectId: null }))
      .then((result) => logger.debug({ event: 'startup.warm', plugins: result.plugins.length }))
      .catch(() => {})
    void miniAppService
      .list(userId, { projectId: null })
      .then((result) => logger.debug({ event: 'startup.warm', miniApps: result.miniApps.length }))
      .catch(() => {})
  }

  return { channelHost, monitorHost, startOpsTimers, warmStartupCaches }
}
