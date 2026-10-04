import { errorMessage } from '../lib/errors'
import { resolveDefaultUserId, userHome } from '../lib/env'
import { createPluginChannelHost } from '../features/plugins/channel-host'
import { createChannelWorkspace } from '../features/plugins/channel-workspace'
import { createPluginMonitorHost } from '../features/plugins/monitor-host'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { readAvailability } from '../features/capabilities/availability'
import { createUsageRepository } from '../features/usage/repository'
import { reconcileUsageInSlices } from '../features/usage/reconcile-slices'
import { runIdleTasks, type IdleTask, type IdleTaskContext } from '../lib/idle-tasks'
import type { InfraPhase } from './infra'
import type { DomainServicesPhase } from './domain-services'
import type { PluginHostRefs } from './plugin-host-refs'
import type { PluginHostsPhase } from './plugin-hosts'
import type { createChatService } from '../features/chat/service'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { bundledPluginsSyncRoot } from '../features/plugins/discovery'
import {
  bundledStagingFailures,
  invalidateBundledSync,
  syncBundledPlugins,
} from '../features/plugins/bundled-install'
import { watchStagedPluginsRoot } from '../features/plugins/bundled-watch'
import { recoverDelegationReports } from '../features/chat/service/recover-delegation'
import { sweepOrphanSessionData } from '../features/plugins/session-storage'

export interface OpsTimersPhaseInput
  extends
    Pick<
      InfraPhase,
      'db' | 'env' | 'logger' | 'catalogService' | 'providerConnectionsService' | 'notifications'
    >,
    Pick<DomainServicesPhase, 'projectsService' | 'skillsCuratorService' | 'pluginService'> {
  chatService: ReturnType<typeof createChatService>
  hostRefs: PluginHostRefs
  pluginConditions: PluginHostsPhase['pluginConditions']
}

export interface OpsTimersPhase {
  channelHost: ReturnType<typeof createPluginChannelHost>
  monitorHost: ReturnType<typeof createPluginMonitorHost>
  startOpsTimers: (signal?: AbortSignal) => void
  warmStartupCaches: () => void
}

/** Which of `ids` still have a session. Bounded batches: SQLite caps bound parameters. */
async function liveSessionIds(
  db: InfraPhase['db'],
  ids: readonly string[],
  ctx: IdleTaskContext,
): Promise<Set<string>> {
  const live = new Set<string>()
  for (let at = 0; at < ids.length; at += 500) {
    const rows = await db
      .selectFrom('agent_sessions')
      .select('id')
      .where('id', 'in', ids.slice(at, at + 500))
      .execute()
    for (const row of rows) live.add(row.id)
    await ctx.yield()
  }
  return live
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
  chatService,
  hostRefs,
  notifications,
  pluginConditions,
}: OpsTimersPhaseInput): OpsTimersPhase {
  // Plugin channels: long-running platform bridges contributed by
  // enabled plugins. Inbound messages run a full agent turn in a persistent
  // chat session; the final reply is returned to the platform by the plugin.
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
  const channelHost = createPluginChannelHost({
    homeDir: userHome(),
    repo: createCapabilitySourceRepository(db, 'plugin'),
    availabilityFor: (userId) => readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
    userId: channelUserId,
    inbound: ({ pluginName, channelName, message }) =>
      chatService.handleChannelInbound(channelUserId, { pluginName, channelName, message }),
    workspace: channelWorkspace,
    conditions: pluginConditions,
    logger: {
      info: (msg) => logger.info({ event: 'plugin_channel.info', msg }),
      warn: (msg, meta) => logger.warn({ event: 'plugin_channel.warn', msg, meta }),
    },
  })
  hostRefs.channelHost = channelHost

  // Plugin background monitors (CC `monitors`, experimental): long-running commands
  // from enabled plugins whose stdout lines surface to the model as notifications,
  // through the one wake delivery. A line wakes ONLY the sessions the plugin armed the
  // monitor for (its `monitors` host service): each line used to wake every root chat of
  // the user, because nothing named the conversation a watcher was for. A line nobody
  // armed reaches nobody and is logged as undelivered. A BUSY armed session is woken too —
  // the wake queue holds it at wake priority and coalesces a burst into one turn. A session
  // that can no longer take a wake (deleted, not a chat) is disarmed on its first miss, so
  // the miss is logged once rather than per line. Provenance 'external' reuses the existing
  // wake source (documented as "another agent, CI, a monitor").
  const monitorHost = createPluginMonitorHost({
    homeDir: userHome(),
    repo: createCapabilitySourceRepository(db, 'plugin'),
    availabilityFor: (userId) => readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
    userId: channelUserId,
    deliver: (note) => {
      const content = `[monitor:${note.pluginName}/${note.monitorName}] ${note.line}`
      for (const sessionId of note.sessionIds)
        hostRefs.wakes!.send(
          { userId: channelUserId, sessionId, content, source: 'external' },
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

  const startOpsTimers = (signal: AbortSignal = new AbortController().signal): void => {
    let recoveringDelegation = false
    const recoverReports = async () => {
      if (recoveringDelegation) return
      recoveringDelegation = true
      try {
        // Every user's children, not only the default user's: a report owed to anyone else
        // would otherwise never be recovered.
        await recoverDelegationReports(db, (request) => chatService.wakeSession(request))
        // The same sweep for a queued question's answer: recorded, but its wake never admitted.
        await chatService.redeliverAnswers()
      } catch (error) {
        logger.warn({ event: 'delegation.recovery_failed', error: errorMessage(error) })
      } finally {
        recoveringDelegation = false
      }
    }
    setInterval(() => void recoverReports(), 60_000).unref?.()

    // A plugin whose source did not build or install is raised as a condition, each time the
    // staged root settles: after a sync, so a copy that failed in THIS pass is in the report.
    const reportStagingFailures = (root: string) =>
      syncBundledPlugins(root, userHome())
        .then(() => bundledStagingFailures(root, userHome()))
        .then((failures) => pluginConditions.stagingFailed(failures))
        .catch((error) =>
          logger.warn({ event: 'plugins.staging_report_failed', error: errorMessage(error) }),
        )
    // Bundled plugins re-staged while this process runs (a scaffold, a backend save in the
    // dev workspace, an app update that lands a new staged root) announce themselves through
    // the staged root's marker. Forget the sync memo and raise the same change every plugin
    // toggle raises, so the catalog and the hosts converge without `/plugin reload`. Armed at
    // once — a re-stage during the idle wait below must not go unseen.
    const stagedRoot = bundledPluginsSyncRoot()
    void stagedRoot.then((root) => {
      if (!root || signal.aborted) return
      const watcher = watchStagedPluginsRoot({
        root,
        onChange: () => {
          invalidateBundledSync()
          pluginService.onChanged?.()
          logger.info({ event: 'plugins.staged_root_changed', root })
          void reportStagingFailures(root)
        },
        log: (msg) => logger.warn({ event: 'plugins.staged_root_watch', msg }),
      })
      if (watcher) {
        logger.info({ event: 'plugins.staged_root_watching', root })
        signal.addEventListener('abort', () => watcher.close(), { once: true })
      }
    })

    // Opportunistic curator cadence: check once idle after startup, then once a day. The marker
    // file (~/.localix/curator-state.json) guarantees at most one real pass per
    // 7 days; the very first observation only seeds the marker (first-run defer).
    const runCuratorCheck = () =>
      skillsCuratorService.maybeRunScheduled(env.LOCALIX_DEFAULT_USER_ID).catch((err) => {
        logger.warn({ event: 'skills_curator.scheduled_error', error: String(err) })
      })
    setInterval(() => void runCuratorCheck(), 24 * 60 * 60 * 1000).unref?.()

    // Everything above only ARMS a cadence. The first run of each job waits for the idle
    // scheduler (`lib/idle-tasks.ts`, which names the stall this prevents), one job at a time.
    // None of them is read by a first request: owed reports are already 30 s past their live
    // path (`recover-delegation.ts`), canonical session usage reads the messages rather than
    // the ledger the reconcile repairs, and a plugin bridge or monitor starting a second later
    // is invisible — while `signal` (shutdown) keeps a host from starting after its stop.
    const idleTasks: IdleTask[] = [
      { name: 'plugin_channels', run: () => channelHost.start() },
      { name: 'plugin_monitors', run: () => monitorHost.start() },
      {
        name: 'staging_report',
        run: () => stagedRoot.then((root) => (root ? reportStagingFailures(root) : undefined)),
      },
      { name: 'delegation_recovery', run: recoverReports },
      {
        name: 'usage_reconcile',
        run: (ctx) =>
          reconcileUsageInSlices(createUsageRepository(db), ctx)
            .then(({ repaired }) => {
              if (repaired > 0) logger.info({ event: 'usage.reconciled', repaired })
            })
            .catch((err) => logger.warn({ event: 'usage.reconcile_failed', err })),
      },
      // Session data whose session is gone (a crash mid-delete, a write racing the delete):
      // every user's, like the recovery. Once per start — deletion itself removes the folder.
      {
        name: 'session_data_sweep',
        run: (ctx) =>
          sweepOrphanSessionData({ existing: (ids) => liveSessionIds(db, ids, ctx) })
            .then((removed) => {
              if (removed.length > 0) {
                logger.info({ event: 'session_data.swept', count: removed.length })
              }
            })
            .catch((error) =>
              logger.warn({ event: 'session_data.sweep_failed', error: errorMessage(error) }),
            ),
      },
      { name: 'skills_curator', run: runCuratorCheck },
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
    void pluginService
      .listPlugins(resolveDefaultUserId(), { projectId: null })
      .then((result) => logger.debug({ event: 'startup.warm', plugins: result.plugins.length }))
      .catch(() => {})
  }

  return { channelHost, monitorHost, startOpsTimers, warmStartupCaches }
}
