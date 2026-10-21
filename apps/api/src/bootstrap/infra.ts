import { buildAgentEngine } from './agent-engine'
import { createChangeFeeds, type ChangeFeeds } from './change-feed'
import { dirname, join } from 'node:path'
import type { DestinationStream } from 'pino'
import type { LocalModelsService } from '../features/local-models/service'
import type { AgentEngine, AgentRuntime, LanguageModelFactory } from '@localixai/agent/runtime'
import { createDatabase, migrateToLatest } from '../db'
import { takeInterruptedRuns } from '../db/migrator'
import { createDigestLoaders } from '../boot/digests'
import { createCatalogService } from '../features/catalog/service'
import { logCatalogRefresh } from '../features/catalog/refresh-schedule'
import { createChatRepository } from '../features/chat/repository'
import { createMediaStore } from '../features/media/store'
import { createProviderConnectionsService } from '../features/provider-connections/service'
import { observeMcpOAuthSecrets } from '../features/mcp/oauth/runtime'
import { mcpClientManager } from '../features/mcp/client-manager'
import { createMcpConditions } from '../features/notifications/conditions/mcp'
import { createProviderConditions } from '../features/notifications/conditions/providers'
import { catalogSettingNames } from '../features/provider-connections/connection-settings'
import { removedSignInsReporter } from '../features/provider-connections/removed-sign-ins'
import {
  createSecretsStore,
  defaultLegacySecretsDir,
  defaultSecretsDir,
  migrateLegacySecrets,
} from '../features/secrets/store'
import { createSecretsService } from '../features/secrets/service'
import { createSecretExposureShield } from '../features/secrets/exposure-shield'
import { createNotificationJournal, type NotificationJournal } from '../features/notifications'
import {
  recordInterruptedRuns,
  startAgentNotifications,
  type AgentNotifications,
} from '../features/notifications/producers'
import { createAttentionRegistry } from '../features/attention/registry'
import { rebuildDurableAttention } from '../features/attention/sources'
import { createPlanRepository } from '../features/plans/repository'
import { redactSecrets } from '../lib/secret-redaction'
import { createUiLocationCatalogService } from '../features/ui-locations/service'
import { warmPreviewProbe } from '../features/agent-core/tools/preview/preview-probe'
import { loadEnv } from '../lib/env'
import { createLogger } from '../lib/logger'
import type { BootstrapServiceRefs } from './chat-service-deps'
import { markLostWorkItems } from '../features/chat/runtime/lost-work'
import { createWorkRegistry, type WorkRegistry } from '../features/work/registry'
import { createWorkRepository } from '../features/work/repository'
import { installBackendHostModules } from '../features/plugins/backend-host-modules'

export interface BootstrapRuntimeInfo {
  instanceId: string
  startedAt: string
  databaseId?: string
  logDestination?: DestinationStream
  /** Also log to stdout while logging to `logDestination` (the development entry). */
  teeStdout?: boolean
  /** True once the owning process began shutdown; `/health` then answers 503. */
  isDraining?: () => boolean
}

export interface InfraPhase {
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  db: ReturnType<typeof createDatabase>
  /** The provider adapter, chosen ONCE here; everything below is typed by its ports. */
  engine: AgentEngine
  agentRuntime: AgentRuntime
  languageModelFactory: LanguageModelFactory
  serviceRefs: BootstrapServiceRefs
  bootRepo: ReturnType<typeof createChatRepository>
  work: WorkRegistry
  interruptedRuns: ReturnType<typeof takeInterruptedRuns>
  digests: ReturnType<typeof createDigestLoaders>
  finalAssistantText: ReturnType<typeof createDigestLoaders>['finalAssistantText']
  loadSessionDigest: ReturnType<typeof createDigestLoaders>['loadSessionDigest']
  loadTerminalDigest: ReturnType<typeof createDigestLoaders>['loadTerminalDigest']
  loadCallDigest: ReturnType<typeof createDigestLoaders>['loadCallDigest']
  loadProjectDigest: ReturnType<typeof createDigestLoaders>['loadProjectDigest']
  loadMessageDigest: ReturnType<typeof createDigestLoaders>['loadMessageDigest']
  secretsStore: ReturnType<typeof createSecretsStore>
  secretsService: ReturnType<typeof createSecretsService>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  /** The Event Center's single source of truth; every phase after this one records into it. */
  notifications: NotificationJournal
  /** The server's agent-lifecycle producers into that journal, threaded to their seams. */
  agentNotifications: AgentNotifications
  catalogService: ReturnType<typeof createCatalogService>
  uiLocationCatalogService: ReturnType<typeof createUiLocationCatalogService>
  providerConnectionsService: ReturnType<typeof createProviderConnectionsService>
  mediaStore: ReturnType<typeof createMediaStore>
  /** Models on this computer: the `local` provider's and semantic search's one source. */
  localModels: LocalModelsService
  /** The change feeds' consumers: the core's (producers write with `recordCoreChanges`), plugins'. */
  changes: ChangeFeeds
}

export async function createInfraPhase(
  envSource: Record<string, string | undefined>,
  runtimeInfo?: BootstrapRuntimeInfo,
): Promise<InfraPhase> {
  // Before anything can import a plugin backend: their shared imports resolve to the host's own
  // modules from here on (`features/plugins/backend-host-modules.ts`).
  installBackendHostModules()
  const env = loadEnv(envSource)
  const logger = createLogger(env.LOG_LEVEL, runtimeInfo?.logDestination, {
    launch: envSource.LOCALIX_LAUNCH_ID?.trim() || undefined,
    teeStdout: runtimeInfo?.teeStdout,
  })

  const db = createDatabase({ filename: env.LOCALIX_DB_FILE })
  await migrateToLatest(db, { defaultUserId: env.LOCALIX_DEFAULT_USER_ID })
  const changes = createChangeFeeds(db, logger)
  const { localModels, engine } = buildAgentEngine({ logger, env })
  const { runtime: agentRuntime, languageModels: languageModelFactory } = engine
  // Forward holder: the terminal service is created below (it depends on
  // chatService for cwd resolution), but chatService needs it to run background
  // jobs in PTY panes. The closure reads it lazily at tool-exec time, by which
  // point it's assigned — so the cycle is broken without ordering gymnastics.
  // Forward holder: the monitor service needs chatService.wakeSession + its stream registry,
  // but chatService needs the monitor service for the `monitor` tool. The closures read it
  // lazily (it's assigned right after chatService), breaking the cycle.
  const serviceRefs: BootstrapServiceRefs = {}

  // Reconcile orphaned runtime state: any session left 'running' from a previous
  // process is dead now (no live run/process survives a restart). Mark it stopped
  // so the UI doesn't show ghost sub-agents/jobs with an inert Stop button — and then SAY SO in
  // the affected transcripts. Reclassifying the rows was never enough on its own: the assistant
  // row keeps whatever the last flush wrote, so the user came back to a truncated answer with no
  // error at all (see announceInterruptedRuns).
  const bootRepo = createChatRepository(db)
  await bootRepo.markRunningSessionsStopped()
  const secretExposureShield = createSecretExposureShield()
  // The notification journal is built here, beside the database and the shield, because every
  // later step has facts to record in it — the first of them the work a restart lost, just below.
  // Text is scrubbed twice before it is stored: exact vault values the shield has seen, then
  // token-shaped strings.
  const notifications = createNotificationJournal({
    db,
    redact: (...args) => redactSecrets(secretExposureShield.redactText(...args)),
    log: (event, detail) => logger.warn({ event, ...detail }),
  })
  // The one work registry, shared by the runner and the monitor service. Hydrated before
  // anything can start work: it learns the ids each session already spent, and turns work the
  // dead process left running into `lost` — on its row and on the tool item that shows it.
  const work = createWorkRegistry({
    repo: createWorkRepository(db),
    logger: { warn: (msg) => logger.warn({ event: 'work.warn', msg }) },
  })
  // The agent-lifecycle producers (`features/notifications/producers`). Started before
  // `hydrate`, whose losses they report, and awaited: a pending question the old process held is
  // settled before this process can ask a new one.
  const lookupSession = (...args: Parameters<typeof bootRepo.getSession>) =>
    bootRepo.getSession(...args)
  // ONE instance of the connection conditions, shared by the run producers (a spent quota, a
  // refused key) and the OAuth refresh path below: each keeps a memo of what it last said, and two
  // memos about the same connection would disagree. The name is looked up lazily, at a run's end,
  // so the service it reads (built further down) exists by then.
  const providerConditions = createProviderConditions(notifications, (userId, connectionId) =>
    providerConnectionsService
      .listConnections(userId)
      .then(({ connections }) => connections.find((c) => c.id === connectionId)?.label),
  )
  const agentNotifications = await startAgentNotifications({
    db,
    journal: notifications,
    attention: createAttentionRegistry({ warn: (msg) => logger.warn({ event: 'attention', msg }) }),
    lookupSession,
    defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
    work,
    provider: providerConditions,
    log: (event, detail) => logger.warn({ event, ...detail }),
  })
  await markLostWorkItems(bootRepo, await work.hydrate(), new Date().toISOString(), {
    warn: (msg) => logger.warn({ event: 'work.lost_item', msg }),
  })
  // A plan presented for review is not lost with the old process: it rejoins the "waiting on
  // you" set from its row.
  await rebuildDurableAttention(agentNotifications.attention, {
    plans: await createPlanRepository(db).listAwaitingReview(),
    getSession: (...args) => bootRepo.getSession(...args),
  })
  // Which sessions had a run in flight, from `agent_runs` — the migration sweep above already
  // reclassified them. NOT from the session sweep: a chat session never reaches
  // `runtime_status='running'`, so that column only ever sees workers, and the first version of
  // this feature announced nothing at all because of it (found by review). Read once; the note
  // itself has to wait for the chat service, which owns the stream registry.
  const interruptedRuns = takeInterruptedRuns()
  await recordInterruptedRuns({ journal: notifications, lookupSession }, interruptedRuns)

  // DB-backed reads behind the composer's `@`-context-refs (session / terminal /
  // call / project / message) + the `localix://resource/chat` nav listing ports, plus the
  // final-assistant-reply readers used by task delegation. They
  // live in the composition root so the owning features (projects / chat /
  // terminal) stay agnostic of each other. `terminalService` is forward-held
  // (assigned below) and read lazily, per request.
  const digests = createDigestLoaders({ db, terminalService: () => serviceRefs.terminalService })
  const {
    finalAssistantText,
    loadSessionDigest,
    loadTerminalDigest,
    loadCallDigest,
    loadProjectDigest,
    loadMessageDigest,
  } = digests

  const secretsStore = createSecretsStore({ db, keyDir: defaultSecretsDir() })
  await migrateLegacySecrets({
    db,
    store: secretsStore,
    legacyDir: defaultLegacySecretsDir(),
  })
  const secretsService = createSecretsService(secretsStore)
  // MCP OAuth material lives in its own AES store, not the vault, so it never reached the shield's
  // other three feeders. A server that echoes its bearer token in a tool result or an error was
  // persisted and streamed verbatim. Registered here because both provider construction sites are
  // process-lifetime module functions no dependency graph reaches.
  observeMcpOAuthSecrets((...args) => secretExposureShield.remember(...args))
  // An MCP server that does not connect is a standing Event Center row, not a log line per turn.
  // The same process-lifetime singleton reason as above.
  mcpClientManager.observeConnections(createMcpConditions(notifications))
  // pi's catalog plus its last refresh; the ops timers fetch newer lists (`ops-timers.ts`).
  const catalogService = createCatalogService({
    source: {
      list: (...args) => engine.listCatalog(...args),
      refresh: (...args) => engine.refreshCatalog(...args),
    },
    onWarmError: (error) => logger.warn({ event: 'catalog.warm_failed', err: error }),
    onRefresh: logCatalogRefresh(logger),
  })
  // A download finished or a model was removed: the `local` provider lists something else now.
  localModels.onListChanged(() => {
    engine.invalidateCatalog?.()
    catalogService.invalidate()
  })
  const uiLocationCatalogService = createUiLocationCatalogService()
  // Restore persisted catalogs (disk, no network; reads wait), then warm for the first turn.
  void catalogService.restore()
  catalogService.warm()
  // Pre-build the visual-feedback probe IIFE so the first preview HTML serve isn't
  // blocked on a cold Bun.build.
  warmPreviewProbe()
  const providerConnectionsService = createProviderConnectionsService({
    db,
    // Provider keys and OAuth tokens ride every model request; registering them with the shield is
    // what lets a provider error body that echoes one back be redacted before it is persisted.
    onCredentialResolved: (...args) => secretExposureShield.remember(...args),
    onCredentialRefresh: (...args) => providerConditions.credentialRefreshed(...args),
    createAuthRuntime: (...args) => engine.createAuth(...args),
    credentialVault: secretsStore,
    // A connection change moves what the catalog lists (embedding models) and what sign-ins broke.
    onChanged: () => (catalogService.invalidate(), reportSignIns()),
    settingNamesFor: catalogSettingNames(catalogService),
  })
  // OAuth connections no sign-in serves any more, in the Event Center from boot on.
  const reportSignIns = removedSignInsReporter(
    {
      connections: providerConnectionsService,
      catalog: catalogService,
      conditions: providerConditions,
    },
    env.LOCALIX_DEFAULT_USER_ID,
    (msg) => logger.warn({ event: 'provider.sign_in_check_failed', msg }),
  )
  reportSignIns()
  // Filesystem media store, rooted beside the db (`~/.localix/media/`). Uploaded
  // media bytes live here as content-addressed files, served by id over
  // /rpc/media/:id — keeping the heavy base64 out of the message-payload db.
  const mediaStore = createMediaStore({ dir: join(dirname(env.LOCALIX_DB_FILE), 'media') })

  return {
    env,
    logger,
    db,
    engine,
    localModels,
    changes,
    agentRuntime,
    languageModelFactory,
    serviceRefs,
    bootRepo,
    work,
    interruptedRuns,
    digests,
    finalAssistantText,
    loadSessionDigest,
    loadTerminalDigest,
    loadCallDigest,
    loadProjectDigest,
    loadMessageDigest,
    secretsStore,
    secretsService,
    secretExposureShield,
    notifications,
    agentNotifications,
    catalogService,
    uiLocationCatalogService,
    providerConnectionsService,
    mediaStore,
  }
}
