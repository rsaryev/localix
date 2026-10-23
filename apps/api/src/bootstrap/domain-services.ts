import { capabilityStores } from './capability-stores'
import { createChatResourceProvider } from '../features/chat/resource-provider'
import { createResourceContextResolver } from '../features/context-fabric/resource-resolver'
import { createHostRefResolver } from '../features/context-fabric/host-ref-resolver'
import { CORE_CONTEXT_MAX_TOKENS } from '../features/context-fabric/contribution-validate'
import { capabilitiesChanged } from '../features/capabilities/revision'
import { createMcpService } from '../features/mcp/service'
import { createPluginService } from '../features/plugins/service'
import { createMiniAppService } from '../features/mini-apps/service'
import { createContributionKindRegistry } from '../features/ext/contribution-kinds'
import { agentContributionSchema } from '../features/agents/contribution'
import { createAgentsService } from '../features/agents/service'
import { createInvocationRegistry } from '../features/capabilities/invocation'
import { createLspManager } from '../features/lsp'
import { createLspConditions } from '../features/notifications/conditions/lsp'
import { createMiniAppInstallFacts } from '../features/notifications/producers/mini-app-installs'
import type { InfraPhase } from './infra'
import { toResourceExpansionResult } from '../features/projects/expand-refs'
import { createProjectsService } from '../features/projects/service'
import { createUserService } from '../features/user/service'
import { createSkillUsageRepository } from '../features/skills-curator/repository'
import { createSkillsCuratorService } from '../features/skills-curator/service'
import { setSkillUsageRecorder } from '../features/agent-core/skill-usage-recorder'
import { createToolUsageRepository } from '../features/tools/usage-repository'
import { setToolRosterRecorder, setToolUsageRecorder } from '../features/tools/usage-recorder'
import type { createDatabase } from '../db'
import type { createLogger } from '../lib/logger'
import { userHome, type loadEnv } from '../lib/env'
import type { createDigestLoaders } from '../boot/digests'
import type { RegistriesPhase } from './registries'
import type { MiniAppHostRefs } from './mini-app-host-refs'
import type { createMiniAppBackendHost } from '../features/mini-apps/backend-host'
import { MINI_APP_WARNINGS, PLUGIN_WARNINGS, warnOnce } from '../lib/warn-once'

export interface DomainServicesPhaseInput
  extends
    Pick<RegistriesPhase, 'contextProviderRegistry' | 'resourceRefsRegistry'>,
    Pick<InfraPhase, 'notifications'> {
  db: ReturnType<typeof createDatabase>
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  digests: ReturnType<typeof createDigestLoaders>
  loadProjectDigest: ReturnType<typeof createDigestLoaders>['loadProjectDigest']
  loadSessionDigest: ReturnType<typeof createDigestLoaders>['loadSessionDigest']
  loadTerminalDigest: ReturnType<typeof createDigestLoaders>['loadTerminalDigest']
  loadCallDigest: ReturnType<typeof createDigestLoaders>['loadCallDigest']
  loadMessageDigest: ReturnType<typeof createDigestLoaders>['loadMessageDigest']
  backendHost: ReturnType<typeof createMiniAppBackendHost>
  hostRefs: MiniAppHostRefs
}

export interface DomainServicesPhase {
  projectsService: ReturnType<typeof createProjectsService>
  userService: ReturnType<typeof createUserService>
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>
  mcpService: ReturnType<typeof createMcpService>
  pluginService: ReturnType<typeof createPluginService>
  miniAppService: ReturnType<typeof createMiniAppService>
  agentsService: ReturnType<typeof createAgentsService>
  lspManager: ReturnType<typeof createLspManager>
  skillUsageRepo: ReturnType<typeof createSkillUsageRepository>
  skillsCuratorService: ReturnType<typeof createSkillsCuratorService>
  toolUsageRepo: ReturnType<typeof createToolUsageRepository>
  /** Bump + poke for a mutation with no host wiring to converge (MCP, an agent's skill save). */
  announceCapabilityChange: () => void
}

export function createDomainServicesPhase({
  db,
  env,
  logger,
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
  notifications,
}: DomainServicesPhaseInput): DomainServicesPhase {
  const warnPluginOnce = warnOnce(logger, PLUGIN_WARNINGS)
  const warnMiniAppOnce = warnOnce(logger, MINI_APP_WARNINGS)
  // One generic resolver bridges every opaque resource scheme into Context Fabric.
  // Core never imports or branches on a concrete mini app/domain here.
  //
  // It is the FALLBACK for every destination: a mini app's own resolver answers its scheme first.
  // It used to be prediction-only, so a chat send resolved the very same URI through a second,
  // host-side expander with no Fabric policy — the duplicate this registration removes. The
  // quota is chat-sized because a sent message owes the model what the user linked; completion
  // callers excerpt from it to their own prompt budget instead of having it dropped here.
  contextProviderRegistry.register({
    provider: createResourceContextResolver(resourceRefsRegistry),
    destinations: ['chat', 'subagent', 'edit-prediction', 'inline-completion'],
    activation: 'explicit',
    defaultEnabled: true,
    fallback: true,
    maxTokens: 32_000,
    timeoutMs: 5_000,
    sensitivity: 'project',
  })
  // Chat-nav provider (`localix://resource/chat` namespace) — projects → sessions → messages as ONE
  // navigable tree in the composer `@resource:` menu. Listing reuses the chat +
  // projects repositories; expansion delegates to the native digest loaders
  // defined above. The composer maps a `localix://resource/chat` node back to its NATIVE token
  // (@project:/@session:/@message:) at link time, so pills/expanders stay native.
  resourceRefsRegistry.register(
    createChatResourceProvider({
      ...digests.chatNavPorts,
      loadProjectDigest,
      loadSessionDigest,
      loadMessageDigest,
    }),
  )
  // projectsService is created AFTER the registry so `@resource:` refs resolve
  // through it (bound to the user); the other digest loaders are defined above.
  const projectsService = createProjectsService({
    db,
    loadSessionDigest,
    loadTerminalDigest,
    loadCallDigest,
    loadProjectDigest,
    loadMessageDigest,
    // The registry's weak `{ok, content?, error?}` bag → the discriminated result the ref
    // expander reads. The adapter is NAMED and unit-tested next to the type that demands
    // it (it decides what a provider's silence means — that is policy, not wiring).
    loadResource: async (...args) =>
      toResourceExpansionResult(await resourceRefsRegistry.expand(...args)),
    // The ownership-checked session-cwd seam: late-bound, because chat is built after this
    // phase and long before any request asks to expand a ref.
    resolveSessionCwd: (...args) => hostRefs.chatServiceForCwd!.resolveSessionCwd(...args),
  })
  // Core's own reference kinds (file/folder/session/message/terminal/call/project/snippet) resolve
  // through Context Fabric like every provider's, so a sent message, an edit prediction and a
  // ghost-text surface all read a linked file through ONE admission policy.
  contextProviderRegistry.register({
    provider: createHostRefResolver(projectsService.expandRefsWithin),
    destinations: ['chat', 'subagent', 'edit-prediction', 'inline-completion'],
    activation: 'explicit',
    defaultEnabled: true,
    // The expanders bound a file at 4,000 lines / 1.5 MB; this ceiling only has to admit that.
    maxTokens: CORE_CONTEXT_MAX_TOKENS,
    timeoutMs: 5_000,
    sensitivity: 'project',
  })
  const userService = createUserService({ db })
  const resolveProjectCwd = async (userId: string, projectId: string) => {
    const project = await projectsService.getProject(userId, projectId).catch(() => null)
    return project?.workingDir ?? null
  }
  hostRefs.resolveProjectCwd = resolveProjectCwd
  // The enumerating half of the `workspaces` mini app seam. Mapped to the seam's own shape here
  // rather than handing the service over, so a mini app never sees a project DTO field the seam
  // did not promise.
  hostRefs.listProjects = async (userId: string) =>
    (await projectsService.listProjects(userId)).projects.map((project) => ({
      id: project.id,
      name: project.name,
      workingDirectory: project.workingDir ?? null,
    }))
  // Late-bound: chatService (which owns the stream registry the capability poke rides)
  // is created far below. Every capability owner announces its mutation through this
  // one closure so there is a single place that decides "bump, then tell the clients".

  /**
   * A capability mutation with NO host wiring to converge (MCP servers connect lazily
   * per run; agent providers are resolved per run too). Bump and poke immediately —
   * waiting for a backend-host settle that will never come would strand clients on a
   * stale revision.
   */
  const announceCapabilityChange = () => {
    capabilitiesChanged()
    hostRefs.publishCapabilityChange?.()
  }
  const mcpService = createMcpService({
    db,
    resolveProjectCwd,
    onChanged: announceCapabilityChange,
  })
  // Late-bound: chatService is created below, but a command's arg-options runner needs a
  // session's cwd. Hold a ref, assign it once chatService exists.
  const contributionKinds = createContributionKindRegistry()
  contributionKinds.register('agent', agentContributionSchema)
  const resolveSessionCwd = async (userId: string, sessionId: string) =>
    (await hostRefs.chatServiceForCwd?.resolveSessionCwd(userId, sessionId).catch(() => null)) ??
    null
  const pluginService = createPluginService({
    db,
    capabilityStores,
    homeDir: userHome(),
    contributionKinds,
    modCommands: () => hostRefs.mods?.commands() ?? [],
    resolveProjectCwd,
    resolveSessionCwd,
    logger: { warn: (msg, meta) => warnPluginOnce({ event: 'plugin.warn', msg, meta }) },
    // A plugin toggle re-converges the plugin hosts (monitors, mods) — no restart needed.
    // Neither has an asynchronous settle to wait for, so the change is settled at once: bump,
    // release a toggle waiting to answer, poke the clients.
    onChanged: () => {
      capabilitiesChanged()
      hostRefs.monitorHost!.refresh()
      hostRefs.mods?.refresh()
      hostRefs.onCapabilitiesSettled?.()
    },
  })
  // Mini apps announce every change on the feed; their hosts are reactors on those notices
  // (`core-reactors.ts`), so nothing here re-converges them.
  const miniAppService = createMiniAppService({
    db,
    capabilityStores,
    homeDir: userHome(),
    contributionKinds,
    resolveProjectCwd,
    resolveSessionCwd,
    invokeUiAction: (...args) => backendHost.invokeUiAction(...args),
    logger: { warn: (msg, meta) => warnMiniAppOnce({ event: 'mini-app.warn', msg, meta }) },
    // A finished install or update is a line in the person's Event Center, said by the store.
    installOutcomes: createMiniAppInstallFacts(notifications, env.LOCALIX_DEFAULT_USER_ID),
  })
  // Managed-Agents registry: file-backed reusable agents + their `agents` ext-state. The
  // invocation registry is the agents service's own dependency and nothing else's, so it is
  // built here and never leaves the phase.
  const invocations = createInvocationRegistry()
  const agentsService = createAgentsService({
    db,
    capabilityStores,
    resolveProjectCwd,
    invocations,
    syncBundledContributions: (...args) => miniAppService.syncBundledContributions(...args),
  })
  hostRefs.listAgents = (...args) => agentsService.listAgents(...args)
  hostRefs.getHuman = (...args) => agentsService.getHuman(...args)
  // A crashed language server is a low-severity Event Center row until it is ready again.
  const lspManager = createLspManager({
    health: createLspConditions(notifications, env.LOCALIX_DEFAULT_USER_ID),
  })

  // Skills curator: usage telemetry + periodic archival of long-unused skills.
  const skillUsageRepo = createSkillUsageRepository(db)
  const skillsCuratorService = createSkillsCuratorService({
    usageRepo: skillUsageRepo,
    resolveProjectCwd,
    capabilitiesChanged: () => void capabilitiesChanged(),
    logger: {
      info: (msg) => logger.info({ event: 'skills_curator.info', msg }),
      warn: (msg) => logger.warn({ event: 'skills_curator.warn', msg }),
    },
  })
  // The skill tool is constructed without DB access — usage ticks flow through
  // this process-wide recorder instead of new tool-registry options.
  setSkillUsageRecorder((name, scope, projectId) =>
    skillUsageRepo.recordUse(env.LOCALIX_DEFAULT_USER_ID, projectId, name, scope),
  )
  // Tool usage: the same singleton-sink arrangement, for the same reason — the two writers live
  // inside the run loop, which has no DB handle. Both sinks return their promise so the recorder
  // can attach the catch; neither is ever awaited by a turn.
  const toolUsageRepo = createToolUsageRepository(db)
  setToolUsageRecorder((toolName, scope) =>
    toolUsageRepo.recordUse(scope.userId, scope.projectId, toolName, { isError: scope.isError }),
  )
  setToolRosterRecorder((toolNames, scope) =>
    toolUsageRepo.recordRoster(scope.userId, scope.projectId, toolNames),
  )
  return {
    projectsService,
    userService,
    resolveProjectCwd,
    mcpService,
    pluginService,
    miniAppService,
    agentsService,
    lspManager,
    skillUsageRepo,
    skillsCuratorService,
    toolUsageRepo,
    announceCapabilityChange,
  }
}
