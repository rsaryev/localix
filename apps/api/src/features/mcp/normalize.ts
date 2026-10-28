import { mcpServerInputSchema, type McpServerInput } from './contracts'
import { asStringArray } from '../../lib/coerce'
import { splitCommandLine } from './command-line'

/**
 * Normalize a single entry from the ecosystem-standard `mcpServers` JSON shape
 * (Claude Desktop / `.mcp.json` / VS Code) into our `McpServerInput`.
 *
 * Transport detection: an entry is `http` when it carries a `url` (or an
 * explicit `type` of `http`/`sse`/`streamable-http`/`streamableHttp`), otherwise
 * `stdio`. We collapse `sse` into `http` because our client manager
 * (`connectClient`) already falls back from Streamable HTTP to legacy SSE on its
 * own — one transport from the user's perspective.
 *
 * Command shape: the standard format uses `command` (a single string) + `args`
 * (array). We flatten that into our `config.command: [command, ...args]`. We also
 * tolerate `command` already being an array (some tools emit that).
 *
 * Returns the validated input, or throws with a human-readable reason so the
 * caller can report a per-server error without aborting the whole import.
 */
export function normalizeMcpServerEntry(
  name: string,
  raw: Record<string, unknown>,
  projectId: string | null,
  defaultEnabled = true,
): McpServerInput {
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : undefined
  // `serverUrl` is used by some MCP registries (e.g. context7) as an alias for `url`
  const resolvedUrl =
    typeof raw.url === 'string'
      ? raw.url
      : typeof raw.serverUrl === 'string'
        ? raw.serverUrl
        : undefined
  // WebSocket transport (`type: "ws"` / `"websocket"`, per CC) shares the remote
  // url/headers shape but connects over WS instead of Streamable HTTP.
  const isWs = type === 'ws' || type === 'websocket'
  const isHttp =
    !isWs &&
    (resolvedUrl !== undefined ||
      type === 'http' ||
      type === 'sse' ||
      type === 'streamable-http' ||
      type === 'streamablehttp')

  const description = typeof raw.description === 'string' ? raw.description : ''
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : defaultEnabled

  const filters = extractFilterFields(raw)

  if (isWs || isHttp) {
    const url = resolvedUrl
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('remote server is missing a "url" or "serverUrl"')
    }
    const headers = coerceStringRecord(raw.headers)
    // A web socket sends its static `headers` on the upgrade; a `headersHelper` is for http
    // servers (Claude Code's reference lists it there), so over a socket it would run for nothing.
    const headersHelper =
      !isWs && typeof raw.headersHelper === 'string' && raw.headersHelper.trim().length > 0
        ? raw.headersHelper
        : undefined
    const oauth = extractOAuth(raw.oauth)
    return attachStartupContract(
      mcpServerInputSchema.parse({
        name,
        description,
        transport: isWs ? 'ws' : 'http',
        enabled,
        projectId,
        config: {
          url,
          ...(headers ? { headers } : {}),
          ...(headersHelper ? { headersHelper } : {}),
          ...(oauth ? { oauth } : {}),
          ...filters,
        },
      }),
      raw,
    )
  }

  const command = toCommandArray(raw.command, raw.args)
  if (command.length === 0) {
    throw new Error('local server is missing a "command"')
  }
  const env = coerceStringRecord(raw.env)
  return attachStartupContract(
    mcpServerInputSchema.parse({
      name,
      description,
      transport: 'stdio',
      enabled,
      projectId,
      config: { command, ...(env ? { env } : {}), ...filters },
    }),
    raw,
  )
}

/**
 * Claude Code's `oauth` block of a server entry: `clientId`, `callbackPort`, `authServerMetadataUrl`
 * and `scopes` (one space-separated string, kept as Localix's `scope`; an array is joined, and
 * Localix's own `scope` key is read too). A client secret is never taken from a file: Claude Code
 * keeps it out of `.mcp.json`, and a committed one would be a leaked credential.
 */
function extractOAuth(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const o = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof o.clientId === 'string' && o.clientId) out.clientId = o.clientId
  const scopes = Array.isArray(o.scopes) ? asStringArray(o.scopes).join(' ') : o.scopes
  const scope = typeof scopes === 'string' && scopes.trim() ? scopes : o.scope
  if (typeof scope === 'string' && scope.trim()) out.scope = scope.trim()
  if (o.callbackPort !== undefined) out.callbackPort = o.callbackPort
  if (o.authServerMetadataUrl !== undefined) out.authServerMetadataUrl = o.authServerMetadataUrl
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * `required` governs connection startup rather than transport construction.
 * Preserve the ecosystem/Codex field after transport-schema validation so both
 * live file sources and bulk imports can enforce it at gather time.
 */
function attachStartupContract(
  input: McpServerInput,
  raw: Record<string, unknown>,
): McpServerInput {
  if (raw.required !== true) return input
  const withContract = {
    ...input,
    config: { ...input.config, required: true },
  }
  return withContract
}

/**
 * Flatten `command` (string | string[]) + optional `args` into one command array.
 *
 * When an `args` array is PRESENT the entry is in canonical ecosystem shape:
 * `command` is a verbatim executable path (which may contain spaces, e.g.
 * `C:\Program Files\nodejs\node.exe`) and must NOT be shell-split. Splitting is a
 * Localix-only convenience for a one-line command pasted WITHOUT a separate `args`.
 */
function toCommandArray(command: unknown, args: unknown): string[] {
  const hasArgs = args !== undefined
  const head = Array.isArray(command)
    ? command.filter((c): c is string => typeof c === 'string')
    : typeof command === 'string' && command.trim().length > 0
      ? hasArgs
        ? [command]
        : splitCommandLine(command)
      : []
  const tail = asStringArray(args)
  return [...head, ...tail]
}

/**
 * Carry the CC-compatible tool-filter + timeout fields from a raw entry into the
 * normalized config so a `.mcp.json` `timeout` / `enabledTools` / `disabledTools`
 * is actually honored at gather time (they were previously dropped on import).
 */
function extractFilterFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (Array.isArray(raw.enabledTools)) {
    const list = asStringArray(raw.enabledTools)
    if (list.length > 0) out.enabledTools = list
  }
  if (Array.isArray(raw.disabledTools)) {
    const list = asStringArray(raw.disabledTools)
    if (list.length > 0) out.disabledTools = list
  }
  if (typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0) {
    out.timeout = Math.floor(raw.timeout)
  }
  return out
}

/**
 * Coerce an `env` / `headers` object into a `Record<string,string>`. A primitive
 * number/boolean value is stringified (so `{ "PORT": 5432 }` doesn't nuke the whole
 * record — the previous all-or-nothing string check dropped the entire object on
 * one non-string value). Object/array/null values are skipped (can't be an env
 * var / header). Returns undefined when nothing usable remains.
 */
function coerceStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
  }
  return Object.keys(out).length > 0 ? out : undefined
}
