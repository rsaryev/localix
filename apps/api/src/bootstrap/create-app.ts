import { createApp } from '../app'
import { createLocalOriginPolicy, parseUiOrigins } from '../lib/local-origin-guard'
import { openPreviewCore } from '../features/agent-core/tools/preview/open-preview'
import { resolveEffectiveAgentConfig } from '../features/effective-config/effective-config'
import type { createChatService } from '../features/chat/service'
import type { BootstrapRuntimeInfo, InfraPhase } from './infra'
import type { RegistriesPhase } from './registries'
import type { PluginHostsPhase } from './plugin-hosts'
import type { DomainServicesPhase } from './domain-services'
import type { AppServicesPhase } from './app-services'
import type { StorageService } from '../features/storage/service'
import type { AgentSessionsService } from '../features/external-agents/backend/service'

export interface CreateAppPhaseInput
  extends
    Pick<
      InfraPhase,
      | 'env'
      | 'logger'
      | 'catalogService'
      | 'uiLocationCatalogService'
      | 'mediaStore'
      | 'notifications'
      | 'agentNotifications'
      | 'secretsService'
      | 'providerConnectionsService'
      | 'serviceRefs'
      | 'work'
      | 'localModels'
    >,
    Pick<RegistriesPhase, 'wsFrameRegistry' | 'resourceRefsRegistry'>,
    Pick<PluginHostsPhase, 'backendHost' | 'firstReconcile'>,
    Pick<
      DomainServicesPhase,
      | 'projectsService'
      | 'userService'
      | 'toolUsageRepo'
      | 'mcpService'
      | 'pluginService'
      | 'agentsService'
      | 'skillsCuratorService'
    >,
    AppServicesPhase {
  runtimeInfo?: BootstrapRuntimeInfo
  chatService: ReturnType<typeof createChatService>
  storageService: StorageService
  externalAgents: AgentSessionsService
}

export interface CreateAppPhase {
  app: ReturnType<typeof createApp>
}

export function createAppPhase({
  externalAgents,
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
  semanticService,
  localModels,
  chatService,
}: CreateAppPhaseInput): CreateAppPhase {
  const app = createApp({
    externalAgents,
    runtimeInfo,
    logger,
    defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
    inlineCompletionService,
    nextEditService,
    // UI-initiated preview open (background-jobs strip) — same core the agent's
    // `browser` tool uses, bound here to the publish-capable stream registry.
    openPreview: (userId, { sessionId, url, root }) =>
      openPreviewCore(
        { userId, sessionId, streamRegistry: chatService.streamRegistry },
        { url, ...(root ? { root } : {}) },
      ),
    catalogService,
    chatService,
    terminalService: serviceRefs.terminalService!,
    work,
    // Built with the session services, which run before this phase (`./session-services`).
    plans: serviceRefs.plans!,
    resume: serviceRefs.resume!,
    comments: serviceRefs.comments!,
    attention: agentNotifications.attention,
    notifications,
    mediaStore,
    // LIVE plugin-route dispatcher — createApp mounts the backend host's stable
    // middleware; the host's mutable mount table serves each wired subsystem's
    // '/rpc/<id>' and survives hot plugin toggles.
    pluginBackendHost: { middleware: () => backendHost.middleware(), firstReconcile },
    wsFrameRegistry,
    resourceRefsRegistry,
    searchService,
    semanticService,
    localModelsService: localModels,
    uiLocationCatalogService,
    secretsService,
    providerConnectionsService,
    projectsService,
    userService,
    effectiveConfigService,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
    // The GC report reads the SAME snapshot service the UI reads, so "what is surfaced" has one
    // answer, and the same effective-config resolver the run pipeline uses for the threshold.
    toolGcSource: {
      getSnapshot: (...args) => capabilitySnapshotService.getSnapshot(...args),
      listUsage: (...args) => toolUsageRepo.list(...args),
      resolveWarnThreshold: async (...args) => {
        const [userId, projectId] = args
        const [userSettings, projectSettings] = await Promise.all([
          userService
            .getProfile(userId)
            .then((profile) => profile?.agentSettings ?? null)
            .catch(() => null),
          projectId
            ? projectsService
                .getProject(userId, projectId)
                .then((project) => project?.settings ?? null)
                .catch(() => null)
            : null,
        ])
        return (
          resolveEffectiveAgentConfig({
            userSettings,
            projectSettings,
            projectScoped: Boolean(projectId),
          }).settings.toolBudgetWarn ?? null
        )
      },
    },
    mcpService,
    pluginService,
    agentsService,
    skillsCuratorService,
    systemService,
    modsHost: serviceRefs.modsHost,
    storageService,
    shellCommandService,
    // Assigned above (forward-held `let`); guaranteed present by this point.
    lspDocumentService: serviceRefs.lspDocumentService!,
    uiDir: env.LOCALIX_UI_DIR,
    // Built once from the boot env: the dev launcher names its Vite origin, a served UI adds the
    // API's own origin, a concrete `HOST` adds its name. An invalid origin stops the boot.
    originPolicy: createLocalOriginPolicy({
      uiOrigins: parseUiOrigins(env.LOCALIX_UI_ORIGINS),
      servesUi: Boolean(env.LOCALIX_UI_DIR),
      bindHost: env.HOST,
    }),
  })

  return { app }
}
