import { expandEnvText, mcpTimeouts, readsAsEmptyTowardRemote } from '@rsaryev/llx-plugin/format'
import type { McpTimeouts } from '@rsaryev/llx-plugin/format'
import type { McpServerRecord } from '../../../mcp/repository'

/**
 * What a server of `mcp`'s registry connects with, as Claude Code decides it: `${VAR}` and
 * `${VAR:-default}` expanded by the kit (mcp.md, "Environment variable expansion in `.mcp.json`")
 * in the fields Claude Code expands, and the connect, tool-call and idle limits (`mcpTimeouts`).
 * `mcp` reaches these through its installed port (`mcp/claude-code-settings.ts`).
 *
 * The record keeps a stdio command as one array (`command`, then `args` when the entry had them), so
 * the walk is over Localix's shape; each text is the kit's `expandEnvText`.
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

const readsAsEmptyRemote = (name: string): boolean =>
  readsAsEmptyTowardRemote(name) || LOCALIX_CREDENTIAL.test(name)

function expander(env: Env) {
  const lookup = (name: string) => env[name]
  const one = (text: string, remote = false) =>
    expandEnvText(text, lookup, remote ? readsAsEmptyRemote : undefined).text
  const table = (value: unknown, remote = false) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).flatMap(([key, text]) =>
            typeof text === 'string' ? [[key, one(text, remote)]] : [],
          ),
        )
      : undefined
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map((text) => one(String(text))) : undefined
  return { one, table, list }
}

/** `config` with every reference of `command`, `args`, `env`, `url` and `headers` expanded. */
export function expandServerConfig(config: Record<string, unknown>, env: Env) {
  const { one, table, list } = expander(env)
  const out: Record<string, unknown> = { ...config }
  if (typeof config.command === 'string') out.command = one(config.command)
  else if (Array.isArray(config.command)) out.command = list(config.command)
  const fields = {
    args: list(config.args),
    env: table(config.env),
    headers: table(config.headers, true),
  }
  for (const [field, value] of Object.entries(fields)) if (value) out[field] = value
  if (typeof config.url === 'string') out.url = one(config.url, true)
  return out
}

/**
 * The config a server connects with, unless the record's config was resolved when it was built
 * (`configExpanded`, a plugin's server): expanding that one again would read `${VAR}` out of a
 * substituted VALUE, and a plugin option whose value is `${GITHUB_TOKEN}` would put the host
 * credential in a remote server's headers.
 */
export const connectServerConfig = (
  server: Pick<McpServerRecord, 'config' | 'configExpanded'>,
  env: Env,
): Record<string, unknown> =>
  server.configExpanded ? { ...server.config } : expandServerConfig(server.config, env)

/** The server's limits under `env` (the API's, the folder's settings `env` over it). */
export const serverTimeouts = (
  server: Pick<McpServerRecord, 'transport' | 'config'>,
  env: Env,
): McpTimeouts =>
  mcpTimeouts((name) => env[name], { transport: server.transport, timeout: server.config.timeout })
