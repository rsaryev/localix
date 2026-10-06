import type { Kysely } from 'kysely'
import type { AgentRuntime, LanguageModelFactory } from '@localixai/agent/runtime'
import type { AgentTool, AgentToolResult } from '@localixai/agent/agents'
import type { ExternalAgentsPort } from '../../external-agents/contracts'

import type { AppDatabase } from '../../../db'
import type { CatalogService } from '../../catalog/service'
import type { ProviderConnectionsService } from '../../provider-connections/service'
import type { AgentRunner } from '../runtime/agent-runner'
import type { HitlRegistry } from '../runtime/hitl-registry'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'
import type { PersistedMessage } from '../contracts'
import type { LspManager } from '../../lsp'
import type { PluginService } from '../../plugins/service-types'
import type {
  TerminalJobHandle,
  TerminalSnapshot,
  TerminalControl,
} from '../../agent-core/tools/terminal/terminal-job'
import type { MediaStore } from '../../media/store'
import type { MonitorService } from '../../monitors/service'
import type { ExitNotices } from '../runtime/exit-notices'
import type { ConfigProposalService } from '../../config-proposals/service'
import type { PlanService } from '../../plans/service'
import type { ResumeRegistry } from '../../resume/registry'
import type { DocumentExtractPort } from '../../agent-core/tools/file/document-ports'
import type { MessageContextBinding } from '@localixai/agent'
import type { SkillDiscoveryLogger } from '../../agent-core/skill-discovery'
import type { RequestSecretPayload } from '../../agent-core/tools/hitl/request-secret'
import type { UiLocationCatalogService } from '../../ui-locations/service'
import type { SkillOverrides } from '../../agent-core/skill-overrides'
import type { ResolveSessionAgent } from './session-agent-selection'
import type { AgentNotifications } from '../../notifications/producers'
import type { ModelRoute } from '../repository-types'
import type { WorkRegistry } from '../../work/registry'
import type { QuestionRegistry } from '../../questions/registry'

export const DEFAULT_TITLE = 'New Chat'

export interface ChatServiceDeps {
  resolveSessionAgent?: ResolveSessionAgent
  /**
   * The model each agent's own card names, by agent ID — the third link of the model chain
   * (see `agent-route-resolution.ts`). A dependency rather than a registry read, because the
   * agent registry is the agents feature's and chat may not import it; a host that wires
   * nothing simply has one fewer level, which the chain already handles.
   */
  loadAgentModelDefaults?: (
    userId: string,
    projectId: string | null,
  ) => Promise<Map<string, Partial<ModelRoute>>>
  /**
   * Skill visibility for a scope, from the capability resolver.
   *
   * A dependency rather than a settings read: which skills a scope may use is one question
   * with one answer, and the run pipeline asks the same resolver.
   */
  loadSkillOverrides?: (
    userId: string,
    projectId: string | null,
    names: readonly string[],
  ) => Promise<SkillOverrides>
  db: Kysely<AppDatabase>
  /** The process's one work registry; the runner records background work in it. */
  work: WorkRegistry
  /** The process's one question registry — queued `ask` questions. Absent in isolated hosts. */
  questions?: QuestionRegistry
  /**
   * The agent-lifecycle producers of the notification journal — a run's end, a HITL request, a
   * handback. Absent in isolated hosts (tests), which then simply record nothing.
   */
  notifications?: AgentNotifications
  catalogService: CatalogService
  providerConnectionsService: ProviderConnectionsService
  hitlRegistry?: HitlRegistry
  streamRegistry?: SessionStreamRegistry
  runner?: AgentRunner
  agentRuntime: AgentRuntime
  languageModelFactory: LanguageModelFactory
  /**
   * The host's plugin service. Supply it and the chat graph uses THAT one; omit it and
   * the graph builds its own (tests, and any consumer with no host).
   *
   * The graph used to always build its own, which meant a running app had two: two
   * inspection caches importing the same plugins, and two `onChanged` owners — only one
   * of which reconciled the live hosts. `bumpUnwiredMutation` in the `/plugin` handler
   * existed solely to paper over the difference.
   */
  pluginService?: PluginService
  /** Immutable frontend-published UI catalogs, selected by id for each workbench run. */
  uiLocationCatalog?: UiLocationCatalogService
  /** Structured diagnostic sink; feature code must never write straight to a host's stdout. */
  logger?: SkillDiscoveryLogger
  lspManager?: LspManager
  /** When set, background bash jobs run in a real PTY pane (terminal feature) via this host. */
  spawnTerminalJob?: (input: {
    userId: string
    /** The run's session — a pane always belongs to one (terminal/contracts.ts). */
    sessionId: string
    cwd: string
    command: string
    wakesAgent?: boolean
  }) => Promise<TerminalJobHandle>
  /** Read a terminal's current output by id (powers `jobs action="read"`). */
  readTerminalJob?: (input: { userId: string; terminalId: string }) => TerminalSnapshot | null
  /** Drives the interactive `terminal` tool (open/screen/keys/type/list/close). */
  terminalControl?: TerminalControl
  /** Kill every PTY bound to a chat session — called when that session is deleted. */
  closeSessionTerminals?: (userId: string, sessionId: string) => void
  /** Filesystem media store — stores generated/uploaded media bytes off the db (by content id). */
  mediaStore?: MediaStore
  /** Optional document-extraction capability resolved from the capability registry. */
  documentExtract?: () => DocumentExtractPort | undefined
  /** The host's capability announcement (bump + client poke); see `RunnerDeps`. */
  announceCapabilityChange?: () => void
  /**
   * Read one value out of the encrypted secrets vault. A NARROW port (resolve-only,
   * never list/write), so chat never imports the secrets feature.
   */
  resolveSecret?: (userId: string, key: string) => Promise<string | undefined>
  /**
   * Write one value into the encrypted secrets vault, create-only (`setIfAbsent` —
   * returns false when the key is taken). The symmetric NARROW port to
   * `resolveSecret`; consumed ONLY by `submitSecret` (the `request_secret` answer
   * leg) — never threaded to the runner or a tool, so the value stays out of the
   * run entirely. Absent in tests → secret submission is refused.
   */
  storeSecret?: (
    userId: string,
    request: RequestSecretPayload,
    value: string,
  ) => Promise<{
    stored: boolean
    outcome: 'created' | 'rotated' | 'exists' | 'missing' | 'conflict'
  }>
  /** User-bound universal Vault manager. Values never enter its model-facing input/result. */
  vaultToolFor?: (userId: string) => AgentTool
  externalAgents?: ExternalAgentsPort
  /** Defense-in-depth boundary for credentials reflected by an upstream tool call. */
  sanitizeToolResult?: (userId: string, result: AgentToolResult) => AgentToolResult
  sanitizeToolError?: (userId: string, error: unknown) => unknown
  /** Vault-value redaction for a bare STRING that leaves the process — a provider error message. */
  sanitizeText?: (userId: string, text: string) => string
  /** Same boundary for a tool call's ARGUMENTS and streaming details (presentation only). */
  sanitizeToolInput?: (userId: string, value: unknown) => unknown
  /**
   * Persist one permission rule the user approved with "Always" onto the agent that asked.
   *
   * A PORT: a permission card is a chat concern and `capability_rule` belongs to the
   * capabilities feature. Absent in an isolated host, and the card then offers only the
   * session grant — the honest answer when nothing can persist.
   */
  persistPermissionRule?: (
    userId: string,
    agentId: string,
    rule: { action: string; resource: string },
  ) => Promise<void>
  /**
   * The monitor service, backing the `monitor` tool. Read through the deps object (a
   * forward-holder getter in bootstrap) because it is constructed AFTER chat — its wake and
   * publish ports are chat's own.
   */
  monitors?: MonitorService
  /** Exactly-once exit notices — the same forward-holder shape as `monitors`. */
  exitNotices?: ExitNotices
  /**
   * The `configure` tool's host (features/config-proposals). Same forward-holder shape as
   * `monitors`: it is composed after chat because it writes through the toggle service.
   */
  configProposals?: ConfigProposalService
  /** The `plan` tool's host (features/plans). Forward-held like `configProposals`. */
  plans?: PlanService
  /** "Continue" — the conversation's unfinished work (features/resume). Forward-held. */
  resume?: ResumeRegistry
  /**
   * The editor's open-buffer text for a file (possibly unsaved), from the LSP document service.
   * Same forward-holder shape as `monitors`: the service is composed after chat.
   */
  editorBufferText?: (userId: string, file: string) => string | undefined
  /** Native registry roster scoped to the requesting invocation host. */
  listInvocableRegistryAgents?: (
    userId: string,
    host: string,
    projectId: string | null,
  ) => Promise<
    {
      agentId: string
      name: string
      description: string
      leadershipPriority?: number
    }[]
  >
  /** Complete scope-aware registry roster used only to describe agents to the model. */
  listRegistryAgents?: (
    userId: string,
    projectId: string | null,
  ) => Promise<
    {
      agentId: string
      name: string
      description: string
      leadershipPriority?: number
      enabled: boolean
      canJoinConversation: boolean
    }[]
  >
  /**
   * Resolve a message's context bindings through Context Fabric, fresh at send time, in the
   * session's own scope and workspace (`context-fabric/binding-capture.ts`). The answers become
   * the bindings' immutable resolutions; absent → every binding resolves as unsupported.
   */
  resolveContextBindings?: (
    userId: string,
    session: { id: string; projectId: string | null; rootSessionId?: string | null },
    bindings: readonly MessageContextBinding[],
  ) => Promise<Map<string, MessageContextBinding['resolution']>>
  now?: () => string
}

export const autoTitle = (current: string, messages: PersistedMessage[]): string => {
  if (current !== DEFAULT_TITLE && current.trim() !== '') return current
  const first = messages.find(
    (message) =>
      message.payload.role === 'user' &&
      !message.payload.isInternal &&
      !message.payload.uiOnly &&
      message.payload.content,
  )
  if (!first?.payload.content) return current
  return first.payload.content.length > 30
    ? `${first.payload.content.slice(0, 30)}...`
    : first.payload.content
}
