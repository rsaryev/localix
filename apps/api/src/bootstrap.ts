import type { WebSocketHandler } from 'bun'
import { websocket } from './features/realtime/ws'
import { MAX_MESSAGE_BINDINGS_TOTAL_BYTES } from './features/chat/contracts'
import { bindChatHostRefs } from './bootstrap/chat-host-refs'
import { createChatServicePhase } from './bootstrap/chat-service-deps'
import { createStorageService } from './features/storage/service'
import { createStorageMaintenance } from './bootstrap/storage-maintenance'
import { createInfraPhase, type BootstrapRuntimeInfo } from './bootstrap/infra'
import { createRegistriesPhase } from './bootstrap/registries'
import { createExternalAgentsPhase } from './bootstrap/external-agents'
import { createPluginHostsPhase } from './bootstrap/plugin-hosts'
import { createDomainServicesPhase } from './bootstrap/domain-services'
import { createEnginesPhase } from './bootstrap/engines'
import { createAgentFacadePhase } from './bootstrap/agent-facade'
import { createAppServicesPhase } from './bootstrap/app-services'
import { createAppPhase } from './bootstrap/create-app'
import { createOpsTimersPhase } from './bootstrap/ops-timers'
import { migrateLegacyPluginInstalls } from './features/plugins/legacy-install-migration'
import { userHome } from './lib/env'
import { loadLoginShellEnv, loginShellEnvSource } from './lib/login-shell-env'

// Bun CLOSES a socket that receives a frame above `maxPayloadLength` (default
// 16MB) — but a `{t:'send'}` RPC legitimately carries up to
// MAX_MESSAGE_BINDINGS_TOTAL_BYTES (~25MB) of inline binding payloads, so the
// default would kill the tab's whole multiplexed firehose on a contract-valid
// send. ×2 headroom covers JSON/prompt overhead. Overridden HERE so every host
// (index.ts, the desktop shell) inherits the same cap via `runtime.websocket`.
// (Annotated with Bun's own handler type — hono/bun's inferred type isn't
// portable in the emitted declarations, TS2883.)
const realtimeWebSocket: WebSocketHandler<unknown> = {
  ...(websocket as unknown as WebSocketHandler<unknown>),
  maxPayloadLength: 2 * MAX_MESSAGE_BINDINGS_TOTAL_BYTES,
}

export async function bootstrap(
  envSource: Record<string, string | undefined> = process.env,
  runtimeInfo?: BootstrapRuntimeInfo,
) {
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
  } = await createInfraPhase(envSource, runtimeInfo)
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
  const { backendHost, hostRefs, startBackendHost, pluginConditions, firstReconcile } =
    createPluginHostsPhase({
      db,
      env,
      logger,
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
  const {
    projectsService,
    userService,
    resolveProjectCwd,
    mcpService,
    pluginService,
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
    agentsService,
    // ONE plugin service for the process. Without this the chat graph built a second,
    // whose `onChanged` bumped the revision but reconciled none of the live hosts.
    pluginService,
    // The `skill` tool's save/delete announces through the same bump + poke as MCP.
    announceCapabilityChange,
    serviceRefs,
  })
  const storageService = createStorageService({
    db,
    deleteSession: (...args) => chatService.deleteSession(...args),
    warn: (message) => logger.warn({ event: 'storage.prune_failed', message }),
  })
  // The plugin hosts' late-bound references to chat, and the ONE wake delivery `wakes`.
  const { wakes } = bindChatHostRefs({ hostRefs, chatService, env, logger, notifications })

  const { auxUsageRepo, startEngines } = await createEnginesPhase({
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
  const {
    systemService,
    shellCommandService,
    inlineCompletionService,
    nextEditService,
    effectiveConfigService,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
    searchService,
  } = createAppServicesPhase({
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
    agentsService,
    skillsCuratorService,
    auxUsageRepo,
    chatService,
  })
  const { app } = createAppPhase({
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
    agentsService,
    skillsCuratorService,
    systemService,
    shellCommandService,
    inlineCompletionService,
    nextEditService,
    effectiveConfigService,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
    searchService,
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
    pluginConditions,
  })
  const startPostListen = (signal?: AbortSignal): Promise<void> => {
    // GUI launches (desktop app, .desktop entry) inherit a bare launchd/systemd
    // env — no version-manager dirs on PATH, no SHELL — so child processes across
    // ANY stack (node/npm, python/pyenv, ruby, cargo, go, git, language servers,
    // MCP servers) fail with "command not found" even though they work in the
    // user's terminal. Fold the user's real login-shell env into process.env ONCE
    // so downstream spawns that spread `{...process.env}` inherit it. No-op from a
    // terminal. (The foreground bash / ripgrep path passes `childEnv()` explicitly
    // — under Bun a spawn with no `env` only ever sees the process-start snapshot.)
    //
    // Non-blocking, and the subsystems that spawn from `process.env` wait for it.
    // The probe used to block JS on this turn, BEFORE the endpoint was published —
    // 330 ms on a cache miss, and up to 10 s with a slow rc against the desktop
    // shell's 12 s start deadline, which then killed and retried the launch. Now
    // READY no longer waits on the user's rc files; the backend host, engines and
    // timers start once `envReady` settles (a snapshot hit settles on this turn);
    // and a request that spawns earlier gets a correct env from `childEnv()`, which
    // resolves synchronously rather than hand out a half-repaired one. A stop that
    // lands first (`signal`) must not have its torn-down subsystems restarted.
    const envStartedAt = performance.now()
    const envReady = loadLoginShellEnv()
    return envReady.then(() => {
      const ms = Math.round(performance.now() - envStartedAt)
      logger.info({ event: 'startup.env_ready', ms, cache: loginShellEnvSource() })
      if (signal?.aborted) return
      startBackendHost()
      startEngines()
      startOpsTimers(signal)
    })
  }
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
    // Carries the attachment-sized maxPayloadLength override (see above).
    websocket: realtimeWebSocket,
    chatService,
    providerConnectionsService,
    // Returned so the process shutdown handler can tear them down cleanly:
    // channelHost stops long-poll messaging bridges via ctx.signal, and
    // lspManager kills spawned language-server child processes.
    channelHost,
    monitorHost,
    lspManager,
    lspDocumentService: serviceRefs.lspDocumentService!,
    systemService,
    terminalService: serviceRefs.terminalService!,
    // Returned so the shutdown handler can kill the agent's background monitors
    // deterministically (watch processes are detached; nothing else reaps them).
    monitorService: serviceRefs.monitorService!,
    // Returned so the shutdown handler can run each subsystem's `onShutdown` hook.
    // A stateless subsystem's is a noop; a stateful one (a bundled workbench that
    // owns long-lived child processes) tears its children down there.
    subsystemRegistry,
  }
}
