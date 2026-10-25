import { createModsPhase } from './bootstrap/mods'
import { realtimeWebSocket } from './bootstrap/realtime-websocket'
import { bindChatHostRefs } from './bootstrap/chat-host-refs'
import { createChatServicePhase } from './bootstrap/chat-service-deps'
import { createStorageService } from './features/storage/service'
import { createStorageMaintenance } from './bootstrap/storage-maintenance'
import { createInfraPhase, type BootstrapRuntimeInfo } from './bootstrap/infra'
import { createRegistriesPhase } from './bootstrap/registries'
import { createExternalAgentsPhase } from './bootstrap/external-agents'
import { createMiniAppHostsPhase } from './bootstrap/mini-app-hosts'
import { createDomainServicesPhase } from './bootstrap/domain-services'
import { createEnginesPhase } from './bootstrap/engines'
import { createAgentFacadePhase } from './bootstrap/agent-facade'
import { createAppServicesPhase } from './bootstrap/app-services'
import { createAppPhase } from './bootstrap/create-app'
import { createStorePhase, invalidateStoreOn } from './bootstrap/store'
import { createOpsTimersPhase } from './bootstrap/ops-timers'
import { startAfterListen } from './bootstrap/post-listen'
import { buildSemanticService } from './bootstrap/semantic'
import { buildDecisionService } from './bootstrap/decisions'
import { migrateLegacyPluginInstalls } from './features/plugins/legacy-install-migration'
import { userHome } from './lib/env'

export async function bootstrap(
  envSource: Record<string, string | undefined> = process.env,
  runtimeInfo?: BootstrapRuntimeInfo,
) {
  const infra = await createInfraPhase(envSource, runtimeInfo)
  const {
    env,
    logger,
    db,
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
    localModels,
  } = infra
  // Semantic search, built from infra alone; every later phase that consumes it gets this one.
  const semanticService = buildSemanticService(infra)
  // Decisions, built from infra alone too: group routing and every mini app host ask through it.
  const decisionService = buildDecisionService(infra)
  // Before any discovery: convert pre-native plugin installs once (idempotent, logged).
  await migrateLegacyPluginInstalls({ db, homeDir: userHome(), logger })
  const {
    subsystemRegistry,
    contextProviderRegistry,
    contextManager,
    textInputSurfaceRegistry,
    wsFrameRegistry,
    capabilityRegistry,
    resourceRefsRegistry,
  } = createRegistriesPhase({ logger, secretsService })
  const externalAgents = createExternalAgentsPhase({
    env,
    logger,
    serviceRefs,
    resourceRefsRegistry,
    contextProviderRegistry,
    wsFrameRegistry,
    subsystemRegistry,
  })
  const { backendHost, hostRefs, startBackendHost, miniAppConditions, firstReconcile } =
    createMiniAppHostsPhase({
      db,
      env,
      logger,
      semanticService,
      decisionService,
      changes: infra.changes,
      notifications,
      serviceRefs,
      secretsStore,
      secretExposureShield,
      mediaStore,
      subsystemRegistry,
      contextProviderRegistry,
      textInputSurfaceRegistry,
      wsFrameRegistry,
      capabilityRegistry,
      resourceRefsRegistry,
    })
  // Claude Code mods: built before chat, which runs every turn through them (`bootstrap/mods.ts`).
  const { modsHost, refreshMods } = createModsPhase({ infra, hostRefs })
  const {
    projectsService,
    userService,
    resolveProjectCwd,
    mcpService,
    pluginService,
    miniAppService,
    agentsService,
    lspManager,
    skillsCuratorService,
    toolUsageRepo,
    announceCapabilityChange,
  } = createDomainServicesPhase({
    db,
    env,
    logger,
    notifications,
    digests,
    loadProjectDigest,
    loadSessionDigest,
    loadTerminalDigest,
    loadCallDigest,
    loadMessageDigest,
    backendHost,
    hostRefs,
    contextProviderRegistry,
    resourceRefsRegistry,
  })
  const { chatService } = createChatServicePhase({
    semanticService,
    decisionService,
    externalAgents: externalAgents.port,
    db,
    work,
    agentNotifications,
    logger,
    catalogService,
    uiLocationCatalogService,
    providerConnectionsService,
    lspManager,
    mediaStore,
    capabilityRegistry,
    secretsStore,
    secretExposureShield,
    secretsService,
    projectsService,
    userService,
    contextManager,
    agentRuntime,
    languageModelFactory,
    ...(infra.engine.scripts ? { scripts: infra.engine.scripts } : {}),
    agentsService,
    // ONE plugin service for the process. Without this the chat graph built a second,
    // whose `onChanged` bumped the revision but reconciled none of the live hosts.
    pluginService,
    miniAppService,
    // The `skill` tool's save/delete announces through the same bump + poke as MCP.
    announceCapabilityChange,
    serviceRefs,
  })
  const storageService = createStorageService({
    db,
    deleteSession: (...args) => chatService.deleteSession(...args),
    warn: (message) => logger.warn({ event: 'storage.prune_failed', message }),
  })
  // The mini app hosts' late-bound references to chat, and the ONE wake delivery `wakes`.
  const { wakes } = bindChatHostRefs({ hostRefs, chatService, env, logger, notifications, db })

  const { auxUsageRepo, startEngines, triggerConditions } = await createEnginesPhase({
    db,
    logger,
    serviceRefs,
    // The monitor service resolves `${secret:KEY}` references from the vault and redacts
    // resolved values out of a watch's output before it becomes a persisted wake.
    secretsStore,
    secretExposureShield,
    work,
    notifications,
    agentNotifications,
    chatService,
    wakes,
    finalAssistantText,
    resolveProjectCwd,
    lspManager,
  })
  await createAgentFacadePhase({
    db,
    env,
    logger,
    chatService,
    wakes,
    agentsService,
    finalAssistantText,
    bootRepo,
    interruptedRuns,
  })
  // The Store before global search: its `store` provider joins the search registry, and it asks
  // that search service once it is built.
  const store = createStorePhase({
    miniAppService,
    mcpService,
    skills: {
      curator: skillsCuratorService,
      files: {
        list: (userId, projectId) => chatService.listSkills(userId, { projectId }),
        get: (userId, name, projectId) => chatService.getSkill(userId, name, { projectId }),
        create: (...args) => chatService.createSkill(...args),
        update: (...args) => chatService.updateSkill(...args),
        remove: (...args) => chatService.deleteSkill(...args),
      },
    },
    db,
    pluginService,
    semanticService,
    resolveProjectCwd,
    owner: env.LOCALIX_DEFAULT_USER_ID,
  })
  const storeService = store.storeService
  // Handed to the app phase whole: its input extends this phase's output.
  const appServices = createAppServicesPhase({
    storeSearchProvider: storeService.searchProvider,
    db,
    env,
    logger,
    catalogService,
    providerConnectionsService,
    languageModelFactory,
    secretsService,
    serviceRefs,
    agentNotifications,
    contextManager,
    textInputSurfaceRegistry,
    backendHost,
    projectsService,
    userService,
    resolveProjectCwd,
    mcpService,
    pluginService,
    miniAppService,
    agentsService,
    skillsCuratorService,
    auxUsageRepo,
    chatService,
    semanticService,
  })
  store.connectSearch(appServices.searchService)
  const { app } = createAppPhase({
    storeService,
    externalAgents: externalAgents.service,
    storageService,
    runtimeInfo,
    env,
    logger,
    catalogService,
    uiLocationCatalogService,
    mediaStore,
    notifications,
    agentNotifications,
    secretsService,
    providerConnectionsService,
    serviceRefs,
    work,
    wsFrameRegistry,
    resourceRefsRegistry,
    backendHost,
    firstReconcile,
    projectsService,
    userService,
    toolUsageRepo,
    mcpService,
    pluginService,
    miniAppService,
    agentsService,
    skillsCuratorService,
    ...appServices,
    localModels,
    chatService,
  })
  const { channelHost, monitorHost, startOpsTimers, warmStartupCaches } = createOpsTimersPhase({
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
    maintainStorage: createStorageMaintenance({
      db,
      logger,
      userId: env.LOCALIX_DEFAULT_USER_ID,
      userService,
      storage: storageService,
    }),
    hostRefs,
    notifications,
    miniAppConditions,
    storeService,
  })
  const startPostListen = (signal?: AbortSignal): Promise<void> =>
    startAfterListen(
      {
        logger,
        start: () => {
          startBackendHost()
          refreshMods()
          startEngines()
          startOpsTimers(signal)
        },
        semantic: { db, logger, localModels, semanticService, changes: infra.changes },
        statusPokes: {
          localModels,
          semanticService,
          store: storeService,
          pluginUpdates: pluginService.updates,
          chatService,
          env,
        },
        coreReactors: {
          db,
          feed: infra.changes.core,
          defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
          catalogService,
          providerConnectionsService,
          projectsService,
          userService,
          agentsService,
          secretsStore,
          notifications,
          sessionExists: async (...args) =>
            Boolean(await bootRepo.getSession(...args).catch(() => true)),
          providerConditions: infra.providerConditions,
          triggerConditions,
          refreshMiniAppHosts: () => {
            backendHost.refresh()
            channelHost.refresh()
          },
          subagentRows: chatService.subagentRowsLive,
          statusLine: chatService.statusLine,
          publish: invalidateStoreOn(storeService, (userId, resources) =>
            chatService.streamRegistry.publish(userId, '', {
              type: 'resources.changed',
              resources,
            }),
          ),
        },
      },
      signal,
    )
  return {
    env,
    logger,
    db,
    app,
    startPostListen,
    warmStartupCaches,
    // Bun WebSocket handler for the multiplexed realtime socket (/rpc/ws). Any
    // host that builds its own Bun.serve (e.g. the desktop shell) MUST pass this
    // alongside `app.fetch`, or the WS upgrade fails with a bad-response error.
    // Carries the attachment-sized maxPayloadLength override (`bootstrap/realtime-websocket.ts`).
    websocket: realtimeWebSocket,
    chatService,
    providerConnectionsService,
    // Returned so the process shutdown handler can tear them down cleanly:
    // channelHost stops long-poll messaging bridges via ctx.signal, and
    // lspManager kills spawned language-server child processes.
    channelHost,
    monitorHost,
    modsHost,
    lspManager,
    lspDocumentService: serviceRefs.lspDocumentService!,
    systemService: appServices.systemService,
    terminalService: serviceRefs.terminalService!,
    // For shutdown: monitors are detached watch processes nothing else reaps.
    monitorService: serviceRefs.monitorService!,
    // Quiesced first at shutdown, while the database and log sink are still open.
    notifications,
    backendHost,
    // For shutdown: each subsystem's `onShutdown` (a stateful one tears its children down).
    subsystemRegistry,
    changes: infra.changes, // For shutdown: its consumers stop before what they write to.
    // For shutdown: stops the indexer, then the local model server process.
    semanticService,
    localModels,
  }
}
