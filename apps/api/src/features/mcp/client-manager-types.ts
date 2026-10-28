import type { McpServerRecord } from './repository'
import type { McpClientLike, McpToolDef } from './mcp-wire'
import type { McpPromptDef } from './mcp-prompts'
import type { ToolMetadataEntry } from './mcp-tool-metadata-cache'

export type McpLogger = { warn(msg: string, meta?: unknown): void }

export interface ClientConnection {
  client: McpClientLike
  /** Listed on (re)connect; re-listed in place on a `tools/list_changed` notification. */
  toolDefs: McpToolDef[]
  /** Listed on (re)connect, and again on `prompts/list_changed`; empty for a server without any. */
  prompts: McpPromptDef[]
  /** The server's `InitializeResult.instructions` (capped), surfaced in the prompt. */
  instructions?: string
}

export interface CacheEntry {
  key: string
  serverName: string
  /** Single-flight: concurrent gathers for the same key await the same connect. */
  promise: Promise<ClientConnection>
  /** Set once `promise` resolves. */
  connection?: ClientConnection
  /** Flipped by transport close / transport-level call failures. */
  broken: boolean
}

export type ToolListSource =
  | {
      state: 'Cached'
      metadata: ToolMetadataEntry
    }
  | {
      state: 'Live'
      entry: CacheEntry
      connection: ClientConnection
    }

export interface McpClientManagerOptions {
  /** Injectable for tests; defaults to the real MCP SDK connect. */
  connect?: (server: McpServerRecord, cwd: string) => Promise<McpClientLike>
  logger?: McpLogger
  /** Overall connect + discovery deadline; injectable only to keep timeout tests fast. */
  startupTimeoutMs?: number
  /** How long a connection waits for `prompts/list` before serving without prompts. */
  promptListTimeoutMs?: number
  /** Source of a channel permission request's id letters; injectable for tests. */
  random?: () => number
}

export interface McpGatherOptions {
  cwd: string
  /**
   * Identifies WHOSE server set this gather represents (e.g. `userId:projectId`).
   * A cached client is evicted only when no scope's latest gather references it —
   * so removing a server in one project doesn't kill another project's client.
   */
  scope?: string
  logger?: McpLogger
  /**
   * Max time to wait for an optional server before backgrounding it (default
   * `DEFAULT_CONNECT_BUDGET_MS`). A required server always stays on the
   * startup path. A backgrounded connect remains cached for the next turn.
   */
  connectBudgetMs?: number
  /**
   * Whether this scope permits one server's tool — the `mcp:<server>/<tool>` rules.
   *
   * Passed in rather than read here for the same reason the enable bit is: this manager
   * caches connections across scopes and knows none of their policy. Absent means no
   * narrowing, which is what a caller with no scope (a health probe) wants.
   */
  toolPolicy?: (serverName: string, toolName: string) => boolean
  /**
   * The conversation this gather runs for. Its plugin servers' channel events go there until
   * another conversation gathers them (`mcp-channels.ts`); absent for a gather that is no chat's.
   */
  channelTarget?: { userId: string; sessionId: string; projectId?: string }
}

export interface McpProbeResult {
  ok: boolean
  /** Tools active after the user's allow/deny filters. */
  tools: string[]
  /** All model-visible tools advertised by the server, including disabled ones. */
  availableTools?: string[]
  error?: string
  /** True only after the server explicitly challenged the client for OAuth. */
  authRequired?: boolean
}

export interface RequiredMcpServerFailure {
  server: string
  error: string
}

/** A required server is an initialization contract, not a best-effort tool source. */
export class RequiredMcpServersError extends Error {
  readonly failures: readonly RequiredMcpServerFailure[]

  constructor(failures: RequiredMcpServerFailure[]) {
    const details = failures.map(({ server, error }) => `${server}: ${error}`).join('; ')
    super(`required MCP servers failed to initialize: ${details}`)
    this.name = 'RequiredMcpServersError'
    this.failures = failures
  }
}

export function isRequiredServer(server: McpServerRecord): boolean {
  return server.config.required === true
}
