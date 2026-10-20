import type { SemanticVectors } from '@localixai/plugin-sdk/backend'
import type { DecisionService } from '../../decisions/service'
import type { GlobalSearchPort } from '../../agent-core/tools/global-search/global-search'
import type { AgentRuntime, LanguageModelFactory, ScriptSandbox } from '@localixai/agent/runtime'
import type { AgentTool } from '@localixai/agent/agents'
import type { ExternalAgentsPort } from '../../external-agents/contracts'
import type { AgentToolResult } from '@localixai/agent/agents'
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../../db'
import type { ChatRepository } from '../repository'
import type { CatalogService } from '../../catalog/service'
import type { ProviderConnectionsService } from '../../provider-connections/service'
import type { LspManager } from '../../lsp'
import type { HitlRegistry } from './hitl-registry'
import type { SessionStreamRegistry } from './session-stream-registry'
import type {
  TerminalJobHandle,
  TerminalSnapshot,
  TerminalControl,
} from '../../agent-core/tools/terminal/terminal-job'
import type { PreviewControl } from '../../agent-core/tools/preview/preview-control'
import type { PluginCommandControl } from './plugin-command-registry'
import type { PluginAuthoring } from '../../plugins/authoring/service'
import type { MediaStore } from '../../media/store'
import type { MonitorService } from '../../monitors/service'
import type { ExitNotices } from './exit-notices'
import type { DocumentExtractPort } from '../../agent-core/tools/file/document-ports'
import type { ConfigProposalService } from '../../config-proposals/service'
import type { PlanService } from '../../plans/service'
import type { SkillDiscoveryLogger } from '../../agent-core/skill-discovery'
import type { UiLocationCatalogService } from '../../ui-locations/service'
import type { WorkRegistry } from '../../work/registry'
import type { AgentNotifications } from '../../notifications/producers'
import type { AgentManagementPort } from '../../agents/service-contract'
import type { HumanProfile } from '../../agent-core/prompt/sections/conversation'

export interface RunnerDeps {
  agentManagement?: AgentManagementPort
  externalAgents?: ExternalAgentsPort
  db: Kysely<AppDatabase>
  /** The process's one work registry — shared with the monitor service, hydrated at boot. */
  work: WorkRegistry
  /** The notification journal's lifecycle producers; a run's logical end reports through it. */
  notifications?: AgentNotifications
  /**
   * The chat repository the runner READS SESSIONS through — the service graph's, with the
   * model chain applied on read (`withResolvedRoutes`), never one of the runner's own.
   *
   * The runner used to build its own from `db`. A seat stores a model only when someone chose
   * one for that participant in that conversation; every other seat is blank and answered on
   * read by the chain. A raw repository returns the blank, so every turn the runner started
   * from its own read — a reaction, a loop tick, a board wake, a webhook — failed with
   * `NO_MODEL` while the typed turns beside it, which arrive carrying the service's resolved
   * record, ran fine. Observed live on the first reaction placed in a room: three
   * "No model selected" rows under three members whose models were in plain view.
   */
  repo: ChatRepository
  providerConnectionsService: ProviderConnectionsService
  catalogService: CatalogService
  hitlRegistry: HitlRegistry
  streamRegistry: SessionStreamRegistry
  /** Engine-neutral agent runtime; the composition root supplies the pi adapter. */
  agentRuntime: AgentRuntime
  /** Engine-neutral factory for buffered auxiliary model calls. */
  languageModelFactory: LanguageModelFactory
  uiLocationCatalog?: UiLocationCatalogService
  /** The API's structured log; `info` carries records worth reading back (`bun run logs`). */
  logger?: SkillDiscoveryLogger & { info?: (record: Record<string, unknown>) => void }
  lspManager?: LspManager
  /**
   * When set, background bash jobs run in a real PTY pane (terminal feature) the
   * user can watch + interact with. Absent → detached child_process. Bound to a
   * user + session per call.
   */
  spawnTerminalJob?: (input: {
    userId: string
    /** The run's session — a pane always belongs to one (terminal/contracts.ts). */
    sessionId: string
    cwd: string
    command: string
    wakesAgent?: boolean
  }) => Promise<TerminalJobHandle>
  /** Read a terminal's current output by id (for `jobs action="read"`). */
  readTerminalJob?: (input: { userId: string; terminalId: string }) => TerminalSnapshot | null
  /** Drives the interactive `terminal` tool (open/screen/keys/type/list/close). */
  terminalControl?: TerminalControl
  /** Backs the `plugin_build` tool: the host's authoring of the user's own plugins. */
  pluginAuthoring?: PluginAuthoring
  /** Drives the `browser` tool — relays commands to the open preview's probe. */
  previewControl?: PreviewControl
  /** Awaitable plugin→UI command relay — backs `ToolSessionContext.emitCommandWithReply` for tools that read their own UI surface back. */
  pluginCommands?: PluginCommandControl
  /**
   * The monitor service — backs `bash until` waits and `jobs read` for a watch that has no
   * PTY. Absent (tests, hosts without it) simply means `until` is unavailable.
   */
  monitors?: MonitorService
  /**
   * Exactly-once exit notices (`./exit-notices`) — a `bash notify` job's finish and a CC
   * `asyncRewake` hook's exit 2 are armed through it. Absent (tests, hosts without triggers): a
   * notify job's finish rides the mid-run reminder instead, and a rewake hook wakes nobody.
   */
  exitNotices?: ExitNotices
  /** Filesystem media store — generated/uploaded media bytes live here (by content id), not as base64 in the db. */
  mediaStore?: MediaStore
  /** Optional document-extraction capability resolved from the capability registry. */
  documentExtract?: () => DocumentExtractPort | undefined
  /**
   * Bump the capability revision and poke clients — for a capability mutation made INSIDE a
   * run (the `skill` tool's save/delete). Absent in isolated hosts: nothing is announced.
   */
  announceCapabilityChange?: () => void
  /** Resolve-only secrets-vault port for runtime features that explicitly need it. */
  resolveSecret?: (userId: string, key: string) => Promise<string | undefined>
  /** User-bound, value-free universal Vault manager contributed by the secrets feature. */
  vaultToolFor?: (userId: string) => AgentTool
  /** Final model boundary for exact Vault-value redaction in tool results and errors. */
  sanitizeToolResult?: (userId: string, result: AgentToolResult) => AgentToolResult
  sanitizeToolError?: (userId: string, error: unknown) => unknown
  /**
   * Same boundary for what a tool call SHOWS rather than returns: its arguments and its streaming
   * progress details. Applied where those become a persisted item, never before execution.
   */
  sanitizeToolInput?: (userId: string, value: unknown) => unknown
  /**
   * Persist one permission rule the user approved with "Always" onto the agent that asked.
   * `capability_rule` is keyed by agent alone, so the id passed here is the whole address.
   *
   * A PORT, not a repository call: a permission card is a chat concern and `capability_rule`
   * belongs to the capabilities feature, which the runtime must not reach into directly.
   * Absent in an isolated host — the card then offers only the session grant, which is the
   * honest answer when nothing can persist.
   */
  persistPermissionRule?: (
    userId: string,
    agentId: string,
    rule: { action: string; resource: string },
  ) => Promise<void>
  /**
   * Same boundary for a bare STRING. Its one caller is `classifyRunError`: a provider rejection's
   * `userMessage` is often the response body verbatim, and that string is persisted as the assistant
   * row's content, published as `run.failed`, and logged with
   * `console.error` — which the pino redaction sink never sees.
   */
  sanitizeText?: (userId: string, text: string) => string
  /**
   * The `configure` tool's host: renders proposal cards and applies APPROVED changes through
   * the capabilities/agents/user services. Composed after chat (it needs the toggle service,
   * which needs chat), so it arrives through a forward-holder getter like `monitors`.
   */
  configProposals?: ConfigProposalService
  /**
   * The `plan` tool's host and the approved-plan prompt section's source (features/plans).
   * Composed after chat — an approval changes a session's mode and wakes it — so forward-held.
   */
  plans?: PlanService
  /** The search palette's service — the agent's `global_search` (forward-held, built after chat). */
  globalSearch?: GlobalSearchPort
  /**
   * The embedding model on demand (`embeddings/semantic-vectors.ts`), null while it cannot run.
   * Group routing's fallback when no decision model is reachable (`floor-advisor.ts`).
   */
  vectors?: SemanticVectors
  /** The decision model (`features/decisions`): group routing's first strategy. */
  decisions?: DecisionService
  /** The engine's script sandbox (`AgentEngine.scripts`): what the `codemode` tool runs on. */
  scripts?: ScriptSandbox
  /**
   * The text of `file` as an editor this user holds it open (possibly unsaved), or undefined.
   * Lets the file tools tell the model when its write lands under the person's unsaved edits.
   */
  editorBufferText?: (userId: string, file: string) => string | undefined
  /**
   * Native registry agents admitted on the requested invocation host.
   * A narrow callback (not the full agents service) so the chat runtime stays
   * decoupled from the agents feature — mirrors the other injected-capability deps.
   * Returns `[]` (or is absent) when the registry is empty.
   */
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
  /** Complete scope-aware registry roster for prompt context, including disabled entries. */
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
  /** The person's record (`@human`) as the scope resolves it, for the prompt and the board. */
  resolveHuman?: (userId: string, projectId: string | null) => Promise<HumanProfile>
  now?: () => string
}

export type { FrozenSessionContext } from './frozen-session-context'
