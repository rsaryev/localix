import {
  readMcpOAuth,
  readMcpServer,
  type McpTransport,
  type PluginMcpServer,
  type RemoteMcpServer,
} from '@rsaryev/llx-plugin/format'
import { mcpServerInputSchema, type McpServerInput } from '../../../mcp/contracts'

/**
 * A Claude Code MCP server as the record Localix stores and connects (`mcp/contracts.ts`). Which
 * entries Claude Code reads, and how, is the kit's: `readMcpServer` for an entry as written (mcp.md,
 * "Option 2": its transports, the `streamable-http` alias, the entries it drops) and `readMcpOAuth`
 * for its `oauth` block. This file only moves the fields the kit read into Localix's record, whose
 * schema then decides what it keeps.
 */

export type McpServerShape = Pick<McpServerInput, 'name' | 'transport' | 'config'>

/** Localix connects SSE through its HTTP client, which falls back to legacy SSE on its own. */
const TRANSPORT_OF: { readonly [T in McpTransport]: McpServerInput['transport'] } = {
  stdio: 'stdio',
  sse: 'http',
  http: 'http',
  ws: 'ws',
}

/** Fields of Localix's record that its own registry also stores on an entry (tool filters). */
const LOCALIX_FIELDS = ['enabledTools', 'disabledTools', 'required'] as const

/** The fields the kit kept beyond the ones it types (its schemas pass `oauth` and the rest through). */
const looseFields = (server: PluginMcpServer) => new Map<string, unknown>(Object.entries(server))

function common(server: PluginMcpServer): Record<string, unknown> {
  const fields = looseFields(server)
  const kept = LOCALIX_FIELDS.filter((key) => fields.get(key) !== undefined).map((key) => [
    key,
    fields.get(key),
  ])
  // The record counts whole milliseconds.
  const timeout = server.timeout && server.timeout > 0 ? Math.floor(server.timeout) : undefined
  return { ...Object.fromEntries(kept), ...(timeout ? { timeout } : {}) }
}

/** The `oauth` block as the kit reads it, in the record's names (`scopes` is the record's `scope`). */
function oauthOf(name: string, server: RemoteMcpServer): Record<string, unknown> | undefined {
  const oauth = readMcpOAuth(name, looseFields(server).get('oauth'), name).oauth
  if (!oauth) return undefined
  const { scopes, ...rest } = oauth
  return { ...rest, ...(scopes ? { scope: scopes } : {}) }
}

function configOf(name: string, server: PluginMcpServer): Record<string, unknown> {
  if ('command' in server) {
    return {
      command: [server.command, ...(server.args ?? [])],
      ...(server.env ? { env: server.env } : {}),
      ...common(server),
    }
  }
  const oauth = oauthOf(name, server)
  return {
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.headersHelper ? { headersHelper: server.headersHelper } : {}),
    ...(oauth ? { oauth } : {}),
    ...common(server),
  }
}

/** A server the kit read or resolved as Localix's record; undefined when the record refuses it. */
export function mcpServerShape(name: string, server: PluginMcpServer): McpServerShape | undefined {
  const parsed = mcpServerInputSchema.safeParse({
    name,
    transport: TRANSPORT_OF[server.type ?? 'stdio'],
    config: configOf(name, server),
  })
  return parsed.success
    ? { name: parsed.data.name, transport: parsed.data.transport, config: parsed.data.config }
    : undefined
}

/** An entry as written (a subagent's inline server): read by the kit, then as Localix's record. */
export function readServerShape(name: string, raw: unknown): McpServerShape | undefined {
  const { server } = readMcpServer(name, raw, name)
  return server && mcpServerShape(name, server)
}
