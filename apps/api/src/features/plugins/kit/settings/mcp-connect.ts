import { expandMcpServer, mcpTimeouts, type PluginMcpServer } from '@rsaryev/llx-plugin/format'
import type { McpTimeouts } from '@rsaryev/llx-plugin/format'
import type { McpServerRecord } from '../../../mcp/repository'
import { kitServerOf } from './mcp-plan'

/**
 * What a server of `mcp`'s registry connects with, as Claude Code decides it: `${VAR}` and
 * `${VAR:-default}` expanded by the kit's `expandMcpServer` (mcp.md, "Environment variable expansion
 * in `.mcp.json`") in the fields Claude Code expands, and the connect, tool-call and idle limits
 * (`mcpTimeouts`). `mcp` reaches these through its installed port (`mcp/claude-code-settings.ts`).
 * The record keeps a stdio command as one array, so it goes to the kit as `command` + `args`
 * (`kitServerOf`) and comes back as one array.
 */

type Env = Readonly<Record<string, string | undefined>>

/**
 * DECISION (owner's, kept on the move to the kit): toward a remote server a name reads as empty when
 * the kit's list says so (Claude Code's own) OR when it looks like a credential by this wider net,
 * which Localix applied before. Claude Code expands `GITHUB_TOKEN`, `GH_TOKEN`, `OPENAI_API_KEY`,
 * `YARN_NPM_AUTH_TOKEN` and any other name off its list into a remote `url` or `headers`; Localix
 * keeps withholding every name this pattern matches. A stdio server still gets them.
 */
const LOCALIX_CREDENTIAL =
  /TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH/i

const readsAsEmpty = (name: string): boolean => LOCALIX_CREDENTIAL.test(name)

/** The kit's expanded server back in the record's shape, over the record's other fields. */
function recordConfigOf(config: Record<string, unknown>, server: PluginMcpServer) {
  if ('url' in server)
    return { ...config, url: server.url, ...(server.headers ? { headers: server.headers } : {}) }
  return {
    ...config,
    ...(Array.isArray(config.command) ? { command: [server.command, ...(server.args ?? [])] } : {}),
    ...(server.env ? { env: server.env } : {}),
  }
}

/**
 * `config` with every reference of the stdio `command` and `env`, or the remote `url` and `headers`,
 * expanded. A remote `url` that is no URL after expansion makes the kit drop the server; the config
 * then stays as written, so connecting fails on that `url` as it would have.
 */
export function expandServerConfig(
  record: Pick<McpServerRecord, 'transport' | 'config'>,
  env: Env,
) {
  const expanded = expandMcpServer('server', kitServerOf(record), (name) => env[name], {
    readsAsEmpty,
  }).server
  return expanded ? recordConfigOf(record.config, expanded) : { ...record.config }
}

/**
 * The config a server connects with, unless the record's config was resolved when it was built
 * (`configExpanded`, a plugin's server): expanding that one again would read `${VAR}` out of a
 * substituted VALUE, and a plugin option whose value is `${GITHUB_TOKEN}` would put the host
 * credential in a remote server's headers.
 */
export const connectServerConfig = (
  server: Pick<McpServerRecord, 'transport' | 'config' | 'configExpanded'>,
  env: Env,
): Record<string, unknown> =>
  server.configExpanded ? { ...server.config } : expandServerConfig(server, env)

/** The server's limits under `env` (the API's, the folder's settings `env` over it). */
export const serverTimeouts = (
  server: Pick<McpServerRecord, 'transport' | 'config'>,
  env: Env,
): McpTimeouts =>
  mcpTimeouts((name) => env[name], { transport: server.transport, timeout: server.config.timeout })
