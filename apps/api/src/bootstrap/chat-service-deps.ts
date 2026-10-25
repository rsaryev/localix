import { claudeCodeHome } from '../features/cc-settings/config-dir'
import { createSkillShellPolicy } from './skill-shell-policy'
import { createSkillSourcePolicy } from './skill-source-lock'
import { installSkillSourcePolicy } from '../features/agent-core/skill-source-policy'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { withChannelPermissionRelay } from './mcp-channels'
import { createSessionSeatResolver } from '../features/agents/session-seat'
import { agentModelDefaultsPort } from '../features/agents/agent-model-defaults'
import type { createTerminalService } from '../features/terminal/service'
import { CAP_DOCUMENT_EXTRACT } from '@localixai/mini-app-sdk/backend'
import type { createCapabilityRegistry } from '../features/ext/capability-registry'
import { captureContextBindings } from '../features/context-fabric/binding-capture'
import type { createContextManager } from '../features/context-fabric/manager'
import {
  resolveContextWorkspace,
  type SessionWorkspacePorts,
} from '../features/context-fabric/session-workspace'
import type { createProjectsService } from '../features/projects/service'
import type { createUserService } from '../features/user/service'
import type { createSecretsService } from '../features/secrets/service'
import type { createSecretExposureShield } from '../features/secrets/exposure-shield'
import type { createSecretsStore } from '../features/secrets/store'
import { createChatVaultPorts } from './chat-vault-ports'
import { createChatService } from '../features/chat/service'
import type { MonitorService } from '../features/monitors/service'
import type { SemanticService } from '../features/embeddings/service'
import type { DecisionService } from '../features/decisions/service'
import type { ExitNotices } from '../features/chat/runtime/exit-notices'
import type { ConfigProposalService } from '../features/config-proposals/service'
import type { PlanService } from '../features/plans/service'
import type { ResumeRegistry } from '../features/resume/registry'
import type { SearchService } from '../features/search/service'
import type { StoreAgentPort } from '../features/store/agent-port'
import type { CommentRepository } from '../features/comments/repository'
import type { createLspDocumentService } from '../features/lsp'
import type { createAgentsService } from '../features/agents/service'
import type { createLogger } from '../lib/logger'
import { createCapabilityRuleRepository } from '../features/capabilities/rule-repository'
import {
  NO_ROSTERS,
  projectCapabilities,
  resolveCapabilities,
} from '../features/capabilities/resolve'
import { createPermissionRulePersister } from '../features/capabilities/availability'
import { createAgentDirectoryPorts } from './agent-directory-ports'
import { createTerminalPorts } from './terminal-ports'
import { createChatFeaturePorts } from './chat-feature-ports'
import { claudeCodeModes } from '../features/cc-settings/settings-modes'
import type { MiniAppService } from '../features/mini-apps/service'
import type { PluginService } from '../features/plugins/service-types'
import type { ModsHost } from '../features/mods/host'

type ChatServiceDeps = Parameters<typeof createChatService>[0]

/**
 * What one sent message may carry as linked context. The expanders already bound each file
 * (4,000 lines / 1.5 MB); this bounds the TURN, which had no ceiling at all before — twenty
 * linked files went to the model whole. A binding past it is still named in the turn, with the
 * reason it was left out.
 */
const CHAT_CONTEXT_MAX_BYTES = 4 * 1024 * 1024

export interface BootstrapServiceRefs {
  terminalService?: ReturnType<typeof createTerminalService>
  monitorService?: MonitorService
  exitNotices?: ExitNotices
  /** The mods host, built before chat but read through the refs like the services above. */
  modsHost?: ModsHost
  lspDocumentService?: ReturnType<typeof createLspDocumentService>
  configProposals?: ConfigProposalService
  /** Built with the session services (it changes a session's mode and wakes through chat). */
  plans?: PlanService
  /** "Continue" (`features/resume`) — built with the session services, beside the plans. */
  resume?: ResumeRegistry
  comments?: CommentRepository
  /** Global search — built with the app services, after chat; the agent's `global_search`. */
  globalSearch?: SearchService
  /** The Store — built after chat; the agent's `store` tool and the `/plugin` commands. */
  store?: StoreAgentPort
}

export interface ChatServicePhaseInput extends Pick<
  ChatServiceDeps,
  | 'db'
  | 'work'
  | 'catalogService'
  | 'providerConnectionsService'
  | 'lspManager'
  | 'mediaStore'
  | 'agentRuntime'
  | 'languageModelFactory'
  | 'scripts'
  | 'announceCapabilityChange'
  | 'externalAgents'
> {
  uiLocationCatalogService: ChatServiceDeps['uiLocationCatalog']
  /** The host's plugin service; chat shares it rather than building a second. */
  pluginService?: PluginService
  /** The host's mini app service: its authoring backs `/mini-app` and `mini_app_build`. */
  miniAppService?: MiniAppService
  agentNotifications: NonNullable<ChatServiceDeps['notifications']>
  logger: ReturnType<typeof createLogger>
  capabilityRegistry: ReturnType<typeof createCapabilityRegistry>
  secretsStore: ReturnType<typeof createSecretsStore>
  secretExposureShield: ReturnType<typeof createSecretExposureShield>
  secretsService: ReturnType<typeof createSecretsService>
  projectsService: ReturnType<typeof createProjectsService>
  userService: ReturnType<typeof createUserService>
  contextManager: ReturnType<typeof createContextManager>
  agentsService: ReturnType<typeof createAgentsService>
  serviceRefs: BootstrapServiceRefs
  /** Semantic search, built from infra before chat: group routing's embedding model. */
  semanticService: Pick<SemanticService, 'vectors'>
  /** Decisions, built from infra before chat: group routing's decision model. */
  decisionService: DecisionService
}

export interface ChatServicePhase {
  chatService: ReturnType<typeof createChatService>
}

export function createChatServicePhase({
  semanticService,
  decisionService,
  externalAgents,
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
  scripts,
  agentsService,
  pluginService,
  miniAppService,
  announceCapabilityChange,
  serviceRefs,
}: ChatServicePhaseInput): ChatServicePhase {
  // `strictPluginOnlyCustomization` (managed settings) closes the person's and the project's skill
  // folders for every discovery in the process; skill discovery lives in the core, so it is handed
  // the answer here rather than reading Claude Code's settings itself.
  installSkillSourcePolicy(createSkillSourcePolicy())
  // One resolver answers "which skills may this scope use", for the run pipeline and for the
  // `/skill` listings alike — they used to read the global settings document separately, and
  // the listing gave a project session the wrong answer.
  const capabilityRules = createCapabilityRuleRepository(db)
  // Read at send time, after `chatService` below exists: the workspace a binding is contained in
  // is the session's effective root, which only the finished chat service can answer.
  const workspacePorts: SessionWorkspacePorts = {
    resolveSessionWorkspaceMetadata: (...args) =>
      chatService.resolveSessionWorkspaceMetadata(...args),
    getProfile: (...args) => userService.getProfile(...args),
    getProject: (...args) => projectsService.getProject(...args),
  }
  const chatService = createChatService({
    externalAgents,
    db,
    work,
    // A channel that relays approvals hears each card its chat opens (`mcp-channels.ts`).
    notifications: {
      ...agentNotifications,
      hitl: withChannelPermissionRelay(agentNotifications.hitl),
    },
    logger,
    // A listing has no turn of its own, so it answers for the agent that always exists.
    loadSkillOverrides: async (userId, _projectId, names) => {
      const at = { userId, agentId: DEFAULT_AGENT_ID }
      const denied = (await resolveCapabilities(capabilityRules, at)).denied('skill', names)
      return Object.fromEntries(denied.map((name) => [name, 'off' as const]))
    },
    // A typed skill's injected commands meet the agent's own permission rules first.
    loadSkillCommandRules: async (userId, agentId) =>
      projectCapabilities(
        await resolveCapabilities(capabilityRules, { userId, agentId }),
        NO_ROSTERS,
      ).permissions,
    // `disableSkillShellExecution`, read from Claude Code's settings for the session's folder.
    skillShellDisabled: createSkillShellPolicy(),
    ports: createChatFeaturePorts(db, { pluginService, miniAppService }),
    announceCapabilityChange,
    catalogService,
    uiLocationCatalog: uiLocationCatalogService,
    providerConnectionsService,
    lspManager,
    mediaStore,
    // Mini app capabilities resolve PER USE: resolving once at boot would freeze hot
    // enable/disable in both directions. An absent provider degrades gracefully.
    documentExtract: () => capabilityRegistry.get(CAP_DOCUMENT_EXTRACT),
    // The vault as chat reaches it: resolve, create-only store, and the agent's `vault` tool.
    ...createChatVaultPorts({ secretsStore, secretExposureShield, secretsService }),
    sanitizeToolResult: (...args) => secretExposureShield.redactResult(...args),
    sanitizeToolError: (...args) => secretExposureShield.redactError(...args),
    sanitizeToolInput: (...args) => secretExposureShield.redactValue(...args),
    // "Always" on a permission card → a row in the PROJECT's own rules, visible and revocable
    // in Settings and outliving the process a session grant dies with.
    persistPermissionRule: createPermissionRulePersister(db),
    sanitizeText: (...args) => secretExposureShield.redactText(...args),
    // Quiet @-link resolution: every binding sent with a message resolves HERE, at send time,
    // through Context Fabric in the session's own scope and workspace — one path and one
    // admission policy for a linked file, a snippet and a mini app's resource alike.
    resolveContextBindings: async (userId, session, bindings) =>
      captureContextBindings(
        contextManager,
        {
          userId,
          session,
          bindings,
          workspace: await resolveContextWorkspace(workspacePorts, userId, session.id).catch(
            () => undefined,
          ),
          maxBytes: CHAT_CONTEXT_MAX_BYTES,
          // Budget for a COLD resource read, not a warm one. This resolves a user's
          // @-links inline on the send path, so it is latency the user feels — but a
          // first link to a live external resource (a chart's exchange connection is
          // established lazily, then pays a full market load plus a quote read) needs
          // seconds, not milliseconds. At 1.5s a cold link reliably blew the deadline;
          // it then fell off the turn entirely, which is the expensive failure. A warm
          // link still returns in well under this and never waits for it.
          deadlineAtMs: Date.now() + 5_000,
          capturedAt: new Date().toISOString(),
        },
        new AbortController().signal,
      ),
    agentRuntime,
    ...(scripts ? { scripts } : {}),
    languageModelFactory,
    // The terminal service is forward-held (built after chat); its ports read it at call time.
    ...createTerminalPorts(serviceRefs, work),
    // Forward holders, same reason as the terminal service above: the monitor service and the
    // exit notices are built on the trigger engine, which needs chatService's wake, and
    // chatService needs them for `bash until` / `bash notify` / hook rewakes. Getters, not
    // values: they are assigned once the engine is built (bootstrap/triggers.ts).
    get monitors() {
      return serviceRefs.monitorService
    },
    get exitNotices() {
      return serviceRefs.exitNotices
    },
    get mods() {
      return serviceRefs.modsHost
    },
    get configProposals() {
      return serviceRefs.configProposals
    },
    get plans() {
      return serviceRefs.plans
    },
    get resume() {
      return serviceRefs.resume
    },
    get globalSearch() {
      return serviceRefs.globalSearch
    },
    get store() {
      return serviceRefs.store
    },
    // The LSP document service is built after chat (it publishes on chat's stream), so the
    // file tools reach its open buffers at call time, like the holders above.
    get editorBufferText() {
      return serviceRefs.lspDocumentService?.openBufferText
    },
    // Who may be seated in a session, and whether this session is a conversation.
    vectors: semanticService.vectors,
    decisions: decisionService,
    resolveSessionAgent: createSessionSeatResolver(agentsService),
    claudeCodeModes: (cwd) => claudeCodeModes({ homeDir: claudeCodeHome(), cwd }),
    loadAgentModelDefaults: agentModelDefaultsPort(agentsService),
    ...createAgentDirectoryPorts(agentsService, {
      cwdOf: async (userId, projectId) =>
        projectId
          ? ((await projectsService.getProject(userId, projectId).catch(() => null))?.workingDir ??
            null)
          : null,
    }),
    agentManagement: agentsService,
  })

  return { chatService }
}
