import { z } from 'zod'

/**
 * Wire contracts for the MCP server registry. These mirror the skill / provider-
 * connection management shape: scoped CRUD over a small record, validated at the
 * route boundary. The transport-specific `config` is a discriminated union so the
 * UI and runtime share one source of truth for what a stdio vs http server needs.
 */

// `ws` (WebSocket) shares the remote `url`/`headers` config shape with `http`; the
// transport enum distinguishes how we connect. `sse` collapses into `http` (the
// client falls back to legacy SSE on its own).
export const MCP_TRANSPORTS = ['stdio', 'http', 'ws'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** Local server: a command we spawn over stdio. */
/**
 * Optional per-server tool filters, shared by both transports. Stored inside the
 * config JSON (no migration needed). Applied at gather time: allowlist first
 * (when set, only listed tools are exposed), then denylist.
 */
const mcpToolFilterFields = {
  /** Fail startup when this server cannot initialize (Codex/ecosystem compatible). */
  required: z.boolean().optional(),
  /** When set, ONLY these tool names are exposed from the server. */
  enabledTools: z.array(z.string().min(1)).optional(),
  /** Tool names hidden from the agent (applied after `enabledTools`). */
  disabledTools: z.array(z.string().min(1)).optional(),
  /**
   * Per-server tool-call wall-clock timeout in MILLISECONDS (CC-compatible: the
   * `.mcp.json` `timeout` field). Overrides the `MCP_TOOL_TIMEOUT` env default
   * for this server only. Values below 1000 are ignored (fall through to the
   * global default), matching the `.mcp.json` convention.
   */
  timeout: z.number().int().positive().optional(),
}

export const mcpStdioConfigSchema = z.object({
  /** Command + args, e.g. ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]. */
  command: z.array(z.string().min(1)).min(1),
  /** Extra environment variables for the spawned process. */
  env: z.record(z.string(), z.string()).optional(),
  ...mcpToolFilterFields,
})
export type McpStdioConfig = z.infer<typeof mcpStdioConfigSchema>

/**
 * A remote URL that is EITHER a valid absolute URL OR a string carrying a
 * `${VAR}` / `${VAR:-default}` token — those are expanded at connect time
 * (see `expand.ts`), so CC's documented `"${API_BASE_URL:-https://…}/mcp"` form
 * must not be rejected at store time. The expanded value is validated when we
 * build the transport (`new URL(url)`), surfacing a bad host as a connect error.
 */
const mcpUrlSchema = z
  .string()
  .min(1)
  .refine(
    (v) => v.includes('${') || z.string().url().safeParse(v).success,
    'Must be a URL, or contain a ${VAR} token expanded at connect time.',
  )

/** Optional OAuth overrides for a remote server (else the SDK auto-discovers + dynamically registers). */
export const mcpOAuthConfigSchema = z.object({
  /** Pre-registered OAuth client id (skips dynamic client registration). */
  clientId: z.string().optional(),
  /** Pre-registered OAuth client secret (confidential clients). */
  clientSecret: z.string().optional(),
  /** Requested OAuth scope (else the server's advertised default). */
  scope: z.string().optional(),
})
export type McpOAuthConfig = z.infer<typeof mcpOAuthConfigSchema>

/** Remote server: a Streamable HTTP / SSE endpoint. */
export const mcpHttpConfigSchema = z.object({
  url: mcpUrlSchema,
  /** Static headers sent with every request (e.g. Authorization). */
  headers: z.record(z.string(), z.string()).optional(),
  /** Optional OAuth client overrides (interactive sign-in handles the rest). */
  oauth: mcpOAuthConfigSchema.optional(),
  ...mcpToolFilterFields,
})
export type McpHttpConfig = z.infer<typeof mcpHttpConfigSchema>

/** A fully materialized server record returned to the UI. */
export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  transport: z.enum(MCP_TRANSPORTS),
  /** '' = global; otherwise the project id this server is scoped to. */
  projectId: z.string(),
  enabled: z.boolean(),
  /** Transport-specific connection details. */
  config: z.union([mcpStdioConfigSchema, mcpHttpConfigSchema]),
  /**
   * OAuth sign-in state for a remote (http) server: `authenticated` (tokens
   * stored), `unauthenticated` (remote server, no stored tokens), or `none`
   * (not an OAuth-capable transport). A missing token alone does NOT mean a
   * public server needs OAuth; the live probe's `authRequired` flag controls the
   * Sign in affordance.
   */
  oauthStatus: z.enum(['authenticated', 'unauthenticated', 'none']).default('none'),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type McpServer = z.infer<typeof mcpServerSchema>

/** Create / update payload. `name` is the stable handle (unique per scope). */
export const mcpServerInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9][a-z0-9_.-]*$/i,
        'Name must start alphanumeric and use only letters, numbers, dots, dashes or underscores.',
      ),
    description: z.string().default(''),
    transport: z.enum(MCP_TRANSPORTS),
    projectId: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    config: z.union([mcpStdioConfigSchema, mcpHttpConfigSchema]),
  })
  .superRefine((val, ctx) => {
    if (val.transport === 'stdio' && !('command' in val.config)) {
      ctx.addIssue({
        code: 'custom',
        message: 'stdio transport requires a command',
        path: ['config'],
      })
    }
    if ((val.transport === 'http' || val.transport === 'ws') && !('url' in val.config)) {
      ctx.addIssue({
        code: 'custom',
        message: `${val.transport} transport requires a url`,
        path: ['config'],
      })
    }
  })
export type McpServerInput = z.infer<typeof mcpServerInputSchema>

/**
 * Bulk import in the ecosystem-standard `{ "mcpServers": { name: {…} } }` shape
 * (Claude Desktop / `.mcp.json` / VS Code). Each entry is a raw, loosely-typed
 * blob; the service normalizes it into our `McpServerInput`s. We accept it
 * permissively here (passthrough records) and validate per-server downstream so
 * one malformed entry doesn't reject the whole paste.
 */
const mcpServersMapSchema = z.record(z.string(), z.record(z.string(), z.unknown()))

export const importMcpServersRequestSchema = z
  .object({
    mcpServers: mcpServersMapSchema.optional(),
    /** VS Code `.vscode/mcp.json` wrapper key — accepted as an alias for `mcpServers`. */
    servers: mcpServersMapSchema.optional(),
    /** Scope all imported servers to this project ('' / null = global). */
    projectId: z.string().nullable().optional(),
    /** Default enabled state for entries with no explicit `enabled`. Pass
     *  `false` so bulk-imported servers land INERT. */
    defaultEnabled: z.boolean().optional(),
  })
  .refine((v) => v.mcpServers !== undefined || v.servers !== undefined, {
    message: 'missing "mcpServers"',
    path: ['mcpServers'],
  })

/** Per-import outcome: which servers landed and which entries failed (and why). */
export const importMcpServersResponseSchema = z.object({
  created: z.array(mcpServerSchema),
  errors: z.array(z.object({ name: z.string(), error: z.string() })),
})
export type ImportMcpServersResponse = z.infer<typeof importMcpServersResponseSchema>

/** Response of starting an interactive OAuth sign-in for a remote server. */
export const startMcpOAuthResponseSchema = z.object({
  /** Open this URL in a browser to authorize (absent when already authenticated). */
  authorizationUrl: z.string().optional(),
  /** True when the server was already authorized — no browser needed. */
  authenticated: z.boolean().optional(),
  /** OAuth state correlating this flow to its loopback callback. */
  state: z.string().optional(),
})

/** Result of a live connection probe — surfaced in the UI as a "Test" button. */
export const mcpServerStatusSchema = z.object({
  ok: z.boolean(),
  /** Names active after the user's per-server allow/deny filters. */
  tools: z.array(z.string()),
  /** All model-visible names advertised by the server, including disabled tools. */
  availableTools: z.array(z.string()).optional(),
  /** Human-readable error when the connection failed. */
  error: z.string().optional(),
  /** The server explicitly challenged the client for OAuth; Sign in is actionable. */
  authRequired: z.boolean().optional(),
})
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>

export const testMcpServerResponseSchema = mcpServerStatusSchema
