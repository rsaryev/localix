import type {
  Resource,
  ResourceContents,
  ResourceTemplate,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'
import type { AgentTool, McpJsonSchema } from '@localixai/agent/agents'

export interface McpGatherResult {
  /** AgentTools ready to merge into the runtime registry (names already namespaced). */
  tools: AgentTool[]
  /** Per-server outcome, for logging / future surfacing. */
  servers: Array<{
    name: string
    ok: boolean
    toolCount: number
    /** True = persisted Cached metadata with no live transport; false = Live tool list. */
    cached: boolean
    error?: string
    /** Connect exceeded the budget and is finishing in the background — tools ready next turn. */
    pending?: boolean
  }>
  /** Namespaced tool name → originating server name (drives prompt inventory grouping). */
  serverByTool: Record<string, string>
  /** Per-server capability instructions (CC `InitializeResult.instructions`), for the prompt. */
  instructions: Array<{ server: string; text: string }>
  /** Names of connected servers that advertise the `resources` capability. */
  resourceServers: string[]
}

export type McpToolAnnotations = Pick<
  ToolAnnotations,
  'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'
>

/** SDK-native resource shapes kept intact through manager/tool projection. */
export type McpResourceDef = Resource
export type McpResourceTemplateDef = ResourceTemplate
export type McpResourceContent = ResourceContents

export interface McpToolDef {
  name: string
  description?: string
  inputSchema: McpJsonSchema
  annotations?: McpToolAnnotations
  /** MCP Apps metadata such as `{ ui: { visibility: ['app', 'model'] } }`. */
  _meta?: Record<string, unknown>
  /**
   * A tool's CC `anthropic/maxResultSizeChars` annotation (per-tool text output
   * cap), captured from the server's `tools/list` at connect time when present.
   */
  maxResultChars?: number
}

/**
 * Minimal client surface the manager needs. The real MCP SDK `Client` satisfies
 * this structurally; tests inject fakes.
 */
export interface McpClientLike {
  listTools(
    params?: undefined,
    options?: { timeout?: number },
  ): Promise<{
    tools?: Array<{
      name: string
      description?: string
      inputSchema: unknown
      annotations?: McpToolAnnotations
      _meta?: Record<string, unknown>
    }>
  }>
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    resultSchema?: undefined,
    options?: { timeout?: number; resetTimeoutOnProgress?: boolean; signal?: AbortSignal },
  ): Promise<{ content?: unknown; isError?: unknown }>
  close(): Promise<void>
  onclose?: (() => void) | undefined
  // Optional resource capability (present on the real SDK client) — used by the
  // consolidated mcp_resources tool for servers that advertise it.
  getServerCapabilities?(): { resources?: unknown; prompts?: unknown } | undefined
  listResources?(
    params?: { cursor?: string },
    options?: { timeout?: number },
  ): Promise<{
    resources?: McpResourceDef[]
    nextCursor?: string
  }>
  listResourceTemplates?(
    params?: { cursor?: string },
    options?: { timeout?: number },
  ): Promise<{
    resourceTemplates?: McpResourceTemplateDef[]
    nextCursor?: string
  }>
  readResource?(
    params: { uri: string },
    options?: { timeout?: number },
  ): Promise<{ contents?: McpResourceContent[] }>
}
