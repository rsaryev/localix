import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { createSessionSeatResolver } from '../features/agents/session-seat'
import { agentModelDefaultsPort } from '../features/agents/agent-model-defaults'
import type { createTerminalService } from '../features/terminal/service'
import { CAP_DOCUMENT_EXTRACT } from '@localixai/plugin-sdk/backend'
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
import { createVaultTool } from '../features/secrets/agent-tool'
import { createChatService } from '../features/chat/service'
import type { MonitorService } from '../features/monitors/service'
import type { SemanticService } from '../features/embeddings/service'
import type { DecisionService } from '../features/decisions/service'
import type { ExitNotices } from '../features/chat/runtime/exit-notices'
import type { ConfigProposalService } from '../features/config-proposals/service'
import type { PlanService } from '../features/plans/service'
import type { ResumeRegistry } from '../features/resume/registry'
import type { SearchService } from '../features/search/service'
import type { CommentRepository } from '../features/comments/repository'
import type { createLspDocumentService } from '../features/lsp'
import type { createAgentsService } from '../features/agents/service'
import type { createLogger } from '../lib/logger'
import { createCapabilityRuleRepository } from '../features/capabilities/rule-repository'
import { resolveCapabilities } from '../features/capabilities/resolve'
import { createPermissionRulePersister } from '../features/capabilities/availability'
import { createAgentDirectoryPorts } from './agent-directory-ports'
import { createTerminalPorts } from './terminal-ports'
import { createChatFeaturePorts } from './chat-feature-ports'
import type { PluginService } from '../features/plugins/service-types'

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
  lspDocumentService?: ReturnType<typeof createLspDocumentService>
  configProposals?: ConfigProposalService
  /** Built with the session services (it changes a session's mode and wakes through chat). */
  plans?: PlanService
  /** "Continue" (`features/resume`) — built with the session services, beside the plans. */
  resume?: ResumeRegistry
  comments?: CommentRepository
  /** Global search — built with the app services, after chat; the agent's `global_search`. */
  globalSearch?: SearchService
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
  announceCapabilityChange,
  serviceRefs,
}: ChatServicePhaseInput): ChatServicePhase {
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
    notifications: agentNotifications,
    logger,
    // A listing has no turn of its own, so it answers for the agent that always exists.
    loadSkillOverrides: async (userId, _projectId, names) => {
      const at = { userId, agentId: DEFAULT_AGENT_ID }
      const denied = (await resolveCapabilities(capabilityRules, at)).denied('skill', names)
      return Object.fromEntries(denied.map((name) => [name, 'off' as const]))
    },
    ports: createChatFeaturePorts(db, { pluginService }),
    announceCapabilityChange,
    catalogService,
    uiLocationCatalog: uiLocationCatalogService,
    providerConnectionsService,
    lspManager,
    mediaStore,
    // Plugin capabilities resolve PER USE: resolving once at boot would freeze hot
    // enable/disable in both directions. An absent provider degrades gracefully.
    documentExtract: () => capabilityRegistry.get(CAP_DOCUMENT_EXTRACT),
    // Resolve-only vault port for runtime features that name a secret — the plugin host's seam.
    resolveSecret: async (userId, key) => {
      const value = await secretsStore.resolve(userId, key, {
        actorType: 'agent',
        actorId: 'chat-runtime',
        consumerType: 'agent',
        consumerId: 'chat-runtime',
      })
      if (value) secretExposureShield.remember(userId, value)
      return value ?? undefined
    },
    // The create-only half of the vault (`setIfAbsent`, never `set`): the `request_secret`
    // answer leg (chatService.submitSecret) writes the typed value here and discards it.
    storeSecret: async (userId, request, value) => {
      // Registered on the WRITE, not only when something later resolves it: the user has just typed
      // this value into the HITL prompt and the very next turn is the one that uses it, so waiting for
      // a later `resolveSecret` leaves the whole first use unshielded — the same read-only gap the
      // provider-connection and MCP registrations closed.
      //
      // But only when the store ACCEPTED it. A review named the cost of registering first: a
      // `missing`/`conflict`/`exists` outcome would permanently redact a value the vault never held,
      // so a mistyped 12-plus-character non-secret (a long path, a branch name) would rewrite every
      // later mention of itself as `[vault-secret]` for the rest of the process.
      const audit = {
        actorType: 'agent' as const,
        actorId: 'chat-runtime',
        consumerType: 'agent',
        consumerId: 'request_secret',
      }
      if (request.action === 'rotate') {
        const result = await secretsStore.rotate(
          userId,
          request.key,
          value,
          request.expectedVersion!,
          audit,
        )
        if (result.status === 'updated') secretExposureShield.remember(userId, value)
        return result.status === 'updated'
          ? { stored: true, outcome: 'rotated' as const }
          : { stored: false, outcome: result.status as 'missing' | 'conflict' }
      }
      const stored = await secretsStore.setIfAbsent(userId, request.key, value, {
        label: request.label ?? request.key,
        description: request.description,
        type: request.type,
        source: 'user',
        tags: [...request.tags, 'agent-requested'],
        audit,
      })
      if (stored) secretExposureShield.remember(userId, value)
      return { stored, outcome: stored ? ('created' as const) : ('exists' as const) }
    },
    vaultToolFor: (userId) =>
      createVaultTool({
        list: () => secretsService.list(userId),
        updateMetadata: (key, request) =>
          secretsStore.updateMetadata(userId, key, request, {
            actorType: 'agent',
            actorId: 'chat-runtime',
            consumerType: 'agent',
            consumerId: 'vault',
          }),
        remove: (key, expectedVersion) =>
          secretsStore.remove(userId, key, {
            expectedVersion,
            audit: {
              actorType: 'agent',
              actorId: 'chat-runtime',
              consumerType: 'agent',
              consumerId: 'vault',
            },
          }),
      }),
    sanitizeToolResult: (...args) => secretExposureShield.redactResult(...args),
    sanitizeToolError: (...args) => secretExposureShield.redactError(...args),
    sanitizeToolInput: (...args) => secretExposureShield.redactValue(...args),
    // "Always" on a permission card → a row in the PROJECT's own rules, visible and revocable
    // in Settings and outliving the process a session grant dies with.
    persistPermissionRule: createPermissionRulePersister(db),
    sanitizeText: (...args) => secretExposureShield.redactText(...args),
    // Quiet @-link resolution: every binding sent with a message resolves HERE, at send time,
    // through Context Fabric in the session's own scope and workspace — one path and one
    // admission policy for a linked file, a snippet and a plugin's resource alike.
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
    // The LSP document service is built after chat (it publishes on chat's stream), so the
    // file tools reach its open buffers at call time, like the holders above.
    get editorBufferText() {
      return serviceRefs.lspDocumentService?.openBufferText
    },
    // Who may be seated in a session, and whether this session is a conversation.
    vectors: semanticService.vectors,
    decisions: decisionService,
    resolveSessionAgent: createSessionSeatResolver(agentsService),
    loadAgentModelDefaults: agentModelDefaultsPort(agentsService),
    ...createAgentDirectoryPorts(agentsService),
    agentManagement: agentsService,
  })

  return { chatService }
}
