import { installResourceSync } from './resource-sync'
import { createAuxAssistServices } from '../boot/aux-assist'
import { buildSearchService } from '../boot/search'
import { createBootShellCommandService } from '../boot/shell-command'
import { createAgentConfigurationService } from '../features/effective-config/service'
import { createTerminalService } from '../features/terminal/service'
import type { TerminalServiceDeps } from '../features/terminal/service-deps'
import { bunPtyBackend } from '../features/terminal/pty-bun'
import { createSystemService } from '../features/system/service'
import type { createChatService } from '../features/chat/service'
import type { InfraPhase } from './infra'
import type { RegistriesPhase } from './registries'
import type { PluginHostsPhase } from './plugin-hosts'
import type { DomainServicesPhase } from './domain-services'
import type { EnginesPhase } from './engines'
import { sessionRoute } from '../features/chat/session-route'
import {
  NO_ROSTERS,
  projectCapabilities,
  resolveCapabilities,
  skillOverridesOf,
} from '../features/capabilities/resolve'
import type { CapabilityRoutesService } from '../features/capabilities/routes'
import { createCapabilityServices, type CapabilityServices } from './capability-services'
import { BUILTIN_TOOL_NAMES } from '../features/agent-core/tool-names'
import { createConfigProposalService } from '../features/config-proposals/service'
import { bumpCapabilityRevision } from '../features/capabilities/revision'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

export interface AppServicesPhaseInput
  extends
    Pick<
      InfraPhase,
      | 'db'
      | 'env'
      | 'logger'
      | 'catalogService'
      | 'providerConnectionsService'
      | 'languageModelFactory'
      | 'secretsService'
      | 'serviceRefs'
      | 'agentNotifications'
    >,
    Pick<RegistriesPhase, 'contextManager' | 'textInputSurfaceRegistry'>,
    Pick<PluginHostsPhase, 'backendHost'>,
    Pick<
      DomainServicesPhase,
      | 'projectsService'
      | 'userService'
      | 'resolveProjectCwd'
      | 'mcpService'
      | 'pluginService'
      | 'agentsService'
      | 'skillsCuratorService'
    >,
    Pick<EnginesPhase, 'auxUsageRepo'> {
  chatService: ReturnType<typeof createChatService>
}

export interface AppServicesPhase {
  systemService: ReturnType<typeof createSystemService>
  shellCommandService: ReturnType<typeof createBootShellCommandService>
  inlineCompletionService: ReturnType<typeof createAuxAssistServices>['inlineCompletionService']
  nextEditService: ReturnType<typeof createAuxAssistServices>['nextEditService']
  effectiveConfigService: ReturnType<typeof createAgentConfigurationService>
  capabilitySnapshotService: CapabilityServices['capabilitySnapshotService']
  capabilityApplyService: CapabilityServices['capabilityApplyService']
  /** One scope's own rules — read and replace. Restated from the route contract so the
   *  phase cannot drift from what the routes require. */
  capabilityPermissions: Pick<CapabilityRoutesService, 'readRules' | 'writeRules'>
  searchService: ReturnType<typeof buildSearchService>
}

export function createAppServicesPhase({
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
}: AppServicesPhaseInput): AppServicesPhase {
  // Host-level system controls (keep-awake, …) — process-wide, in-memory.
  const systemService = createSystemService({ logger })

  // `localix` shell-command install ("install in PATH"). The launcher
  // execs the bundled CLI shim under this very Bun. The desktop shell sets
  // LOCALIX_CLI_ENTRY to the staged shim; in the repo we fall back to the source
  // shim. When neither resolves (plain web run) the feature reports unavailable.
  const shellCommandService = createBootShellCommandService({
    cliEntryFromEnv: env.LOCALIX_CLI_ENTRY,
    logger,
  })

  // Interactive terminal: real PTY (Bun native) per chat-session workspace. The
  // cwd is resolved through chatService's ownership-checked metadata seam, so the
  // feature never imports chat internals or enumerates the Explorer root.
  const publishTerminalFrame: TerminalServiceDeps['publishLifecycle'] = (
    userId,
    sessionId,
    event,
  ) => chatService.streamRegistry.publish(userId, sessionId, { ...event, sessionId })
  serviceRefs.terminalService = createTerminalService({
    backend: bunPtyBackend,
    // Two consumers of one lifecycle: the live frame every client renders, and the journal row a
    // finished command pane earns when no work record stands for it (the producer filters).
    publishLifecycle: (...args) => {
      publishTerminalFrame(...args)
      agentNotifications.work.terminalLifecycle(...args)
    },
    // A takeover or a served URL, pushed so the composer does not wait for its registry poll.
    publishState: (userId, sessionId, event) =>
      chatService.streamRegistry.publish(userId, sessionId, { ...event, sessionId }),
    // resolveSessionCwd is the ownership gate. A foreign/stale id fails closed, and there is
    // no session-less branch: a terminal without a session used to open in HOME, bound to
    // nothing, and outlived every chat (the contract now requires the session).
    resolveCwd: (...args) => chatService.resolveSessionCwd(...args),
  })

  // Edit prediction plus one shared inline-completion route. Code prediction, chat input and every
  // contributed text field reuse its provider/model/reasoning assignment.
  const {
    aux: modelRoutingAux,
    nextEditService,
    inlineCompletionService,
  } = createAuxAssistServices({
    db,
    catalogService,
    providerConnectionsService,
    languageModelFactory,
    contextManager,
    chatService,
    userService,
    projectsService,
    // Contributed text-input surfaces (a commit subject, a query, a name), resolved per call so a
    // plugin toggle takes effect without a restart.
    contributedCompletionSurface: (...args) => textInputSurfaceRegistry.get(...args),
    auxUsageRepo,
  })

  // What a scope may do — the snapshot the screens read, the toggle the switches write,
  // and the rule list the editor replaces. Composed together in `capability-services.ts`
  // so all three share one repository instance and one resolver.
  const {
    capabilityRules,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
  } = createCapabilityServices({
    db,
    chatService,
    projectsService,
    userService,
    resolveProjectCwd,
    mcpService,
    pluginService,
    agentsService,
  })

  // The `configure` tool's host. Every write path it delegates to already exists above or in
  // the domain phase; this only binds them as ports. Forward-held because the chat runtime
  // (which builds the tool) was composed before the apply service (which lands a change).
  serviceRefs.configProposals = createConfigProposalService({
    db,
    ports: {
      rules: {
        readSnapshot: (...args) => capabilityRules.readSnapshot(...args),
        mutate: (...args) => capabilityRules.mutate(...args),
      },
      capabilities: { apply: (...args) => capabilityApplyService.apply(...args) },
      agents: agentsService,
      user: {
        getAgentSettings: async (...args) =>
          ((await userService.getProfile(...args).catch(() => null))?.agentSettings ??
            null) as Record<string, unknown> | null,
      },
      bumpCapabilityRevision: () => {
        bumpCapabilityRevision()
      },
    },
  })

  // Read-only effective-agent-configuration diagnostics. Composes the SAME reads the
  // runtime uses (user profile, project settings, session model/mode, the workload-route
  // model resolver) into one resolved view with provenance + reload class + validation.
  // Diagnostics only — never mutates state, never surfaces a secret/credential/prompt.
  const effectiveConfigService = createAgentConfigurationService({
    // The report explains what the run will do, so it reads the run's own answer — over the
    // same rosters, because a projection can only subtract from what it is handed.
    loadCapabilities: async (userId: string, projectId: string | null) => {
      const [resolved, skills] = await Promise.all([
        // A diagnostics report with no agent named describes the one that always exists.
        resolveCapabilities(capabilityRules, { userId, agentId: DEFAULT_AGENT_ID }),
        skillsCuratorService
          .listSkills(userId, { projectId: projectId ?? '' })
          .then((list) => list.map((skill) => skill.name))
          .catch(() => [] as string[]),
      ])
      const projection = projectCapabilities(resolved, {
        ...NO_ROSTERS,
        tool: BUILTIN_TOOL_NAMES,
        skill: skills,
      })
      return {
        permissions: projection.permissions,
        disabledTools: projection.denied.tool,
        skillOverrides: skillOverridesOf(projection.denied.skill),
      }
    },
    loadUserAgentSettings: async (...args) =>
      (await userService.getProfile(...args).catch(() => null))?.agentSettings ?? null,
    loadProjectSettings: async (...args) =>
      (await projectsService.getProject(...args).catch(() => null))?.settings ?? null,
    loadSession: async (userId, sessionId) => {
      const s = await chatService
        .getSession(userId, sessionId, { messageLimit: 0 })
        .catch(() => null)
      if (!s) return null
      return {
        projectId: s.projectId ?? null,
        modelId: sessionRoute(s).modelId || null,
        providerConnectionId: sessionRoute(s).providerConnectionId,
      }
    },
    resolveModel: async (userId, modelId, preferred) => {
      const built = await modelRoutingAux
        .buildLanguageModel(userId, modelId, preferred)
        .catch(() => null)
      return built ? { providerConnectionId: built.providerConnectionId, modelId } : null
    },
    listSkillNames: async (userId, projectId) =>
      (await skillsCuratorService.listSkills(userId, { projectId }).catch(() => [])).map(
        (s) => s.name,
      ),
    listPlugins: async (userId, projectId) =>
      (await pluginService.listPlugins(userId, { projectId }).catch(() => ({ plugins: [] })))
        .plugins,
  })

  // Global search: ONE registry fanning a text query out across domain providers
  // (projects, chat sessions/messages, the bundled workbenches,
  // files, secrets, skills, plugins, MCP, agent providers, models). Composed in
  // boot/search.ts; registration order IS the group order.
  const searchService = buildSearchService({
    db,
    projectsService,
    chatService,
    backendHost,
    secretsService,
    skillsCuratorService,
    pluginService,
    mcpService,
    agentsService,
    catalogService,
  })

  installResourceSync({
    chatService,
    projectsService,
    userService,
    providerConnectionsService,
    agentsService,
    secretsService,
    systemService,
    defaultUserId: env.LOCALIX_DEFAULT_USER_ID,
  })

  return {
    systemService,
    shellCommandService,
    inlineCompletionService,
    nextEditService,
    effectiveConfigService,
    capabilitySnapshotService,
    capabilityApplyService,
    capabilityPermissions,
    searchService,
  }
}
