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
  /**
   * Hear this server as a Claude Code channel (`mcp-channels.ts`) when it declares one: its events
   * become turns in the chat that last used it. Claude Code's `--channels server:<name>` opt-in; a
   * plugin's server needs none, its plugin being enabled is the opt-in.
   */
  channel: z.boolean().optional(),
}

export const mcpStdioConfigSchema = z.object({
  /** Command + args, e.g. ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]. */
  command: z.array(z.string().min(1)).min(1),
  /** Extra environment variables for the spawned process. */
  env: z.record(z.string(), z.string()).optional(),
  ...mcpToolFilterFields,
})

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
  /** Requested OAuth scope (else the server's advertised default). Claude Code's `scopes`. */
  scope: z.string().optional(),
  /** Fixed loopback port of the sign-in callback: the redirect is `http://localhost:PORT/callback`. */
  callbackPort: z.number().int().min(1).max(65535).optional(),
  /** Authorization server metadata document, in place of the discovery chain. */
  authServerMetadataUrl: z
    .string()
    .refine((v) => v.startsWith('https://') && z.string().url().safeParse(v).success, {
      message: 'authServerMetadataUrl must be an https:// URL',
    })
    .optional(),
})
export type McpOAuthConfig = z.infer<typeof mcpOAuthConfigSchema>

/** Remote server: a Streamable HTTP / SSE endpoint. */
export const mcpHttpConfigSchema = z.object({
  url: mcpUrlSchema,
  /** Static headers sent with every request (e.g. Authorization). */
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * Claude Code's `headersHelper`: a shell command whose stdout is a JSON object of headers, run on
   * each connection (`headers-helper.ts`). Dynamic headers win a name the static ones set.
   */
  headersHelper: z.string().min(1).optional(),
  /** Optional OAuth client overrides (interactive sign-in handles the rest). */
  oauth: mcpOAuthConfigSchema.optional(),
  ...mcpToolFilterFields,
})

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

/** The stable handle of a server, unique per scope: it names its rules and its vault items. */
export const mcpServerNameSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9_.-]*$/i,
    'Name must start alphanumeric and use only letters, numbers, dots, dashes or underscores.',
  )

/** Create / update payload. `name` is the stable handle (unique per scope). */
export const mcpServerInputSchema = z
  .object({
    name: mcpServerNameSchema,
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
