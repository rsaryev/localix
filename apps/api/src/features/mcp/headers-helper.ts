import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

import { isCredentialEnvName } from '../../lib/credential-env-name'
import { errorMessage } from '../../lib/errors'
import { childEnvNonInteractive } from '../../lib/login-shell-env'
import { claudeConfigDir } from '../cc-settings/config-dir'
import type { McpServerRecord } from './repository'

const execFileAsync = promisify(execFile)

/**
 * CLAUDE CODE'S `headersHelper` for a remote MCP server (mcp.md, "headersHelper"): a shell command
 * whose stdout is one JSON object of string headers. It runs fresh on each connection (nothing is
 * cached: the script reuses its own token) and again, once, when the server answers 401 or 403
 * (`mcp-remote-request.ts`); it has 10 seconds; and its headers win a name the static `headers`
 * set. It gets `CLAUDE_CODE_MCP_SERVER_NAME`, `CLAUDE_CODE_MCP_SERVER_URL` and, for a plugin's
 * server, `CLAUDE_PLUGIN_ROOT`. For a server of a project `.mcp.json` or a plugin the
 * credential-looking variables are removed from its environment.
 *
 * WHO MAY RUN IT. Only a server that came from a Claude Code file or a plugin: a helper is a shell
 * command, so a record of Localix's own registry (which no screen gives one) never runs it. A
 * project or local server's helper is dropped before it reaches here until the folder is trusted
 * (`claude-code-servers.ts`); a plugin's runs because the person enabled the plugin, as its stdio
 * servers do.
 *
 * Working directory: the plugin's root; the project directory for a project or local server;
 * otherwise Claude Code's configuration directory.
 */

export const HEADERS_HELPER_TIMEOUT_MS = 10_000

// Claude Code removes names holding any of these, a wider net than `isCredentialEnvName`.
const CREDENTIAL_LIKE = /TOKEN|SECRET|PASSWORD|KEY|AUTH/i

export interface HeadersHelperRun {
  command: string
  serverName: string
  serverUrl: string
  cwd: string
  pluginRoot?: string
  stripCredentials: boolean
  timeoutMs?: number
  /** The environment the helper starts from (default: the API's, non-interactive). */
  env?: NodeJS.ProcessEnv
}

/** The headers the command prints; throws when it fails, runs over, or prints anything else. */
export async function runHeadersHelper(run: HeadersHelperRun): Promise<Record<string, string>> {
  const base = run.env ?? childEnvNonInteractive()
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (run.stripCredentials && (CREDENTIAL_LIKE.test(name) || isCredentialEnvName(name))) continue
    env[name] = value
  }
  env.CLAUDE_CODE_MCP_SERVER_NAME = run.serverName
  env.CLAUDE_CODE_MCP_SERVER_URL = run.serverUrl
  if (run.pluginRoot) env.CLAUDE_PLUGIN_ROOT = run.pluginRoot
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('sh', ['-c', run.command], {
      cwd: run.cwd,
      timeout: run.timeoutMs ?? HEADERS_HELPER_TIMEOUT_MS,
      env,
      windowsHide: true,
    }))
  } catch (error) {
    throw new Error(`headersHelper for "${run.serverName}" failed: ${errorMessage(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`headersHelper for "${run.serverName}" did not print a JSON object`)
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed))
    if (typeof value === 'string') headers[name] = value
  return headers
}

export interface RequestHeaders {
  /** Static headers with the helper's merged over them. */
  headers: Record<string, string>
  /** A helper ran (or would): its output may carry the credential, so OAuth is not the fallback. */
  helped: boolean
  /** Runs the helper again for the same server, for the 401/403 retry. */
  refresh?: () => Promise<Record<string, string>>
}

/** Where a record came from, by id: `plugin:…` and `claude-code:<scope>:…` may run a helper. */
function origin(id: string): { kind: 'plugin' | 'project' | 'local' | 'other' } | undefined {
  if (id.startsWith('plugin:')) return { kind: 'plugin' }
  const scope = /^claude-code:([a-z]+):/.exec(id)?.[1]
  if (!scope) return undefined
  return { kind: scope === 'project' ? 'project' : scope === 'local' ? 'local' : 'other' }
}

/**
 * The headers `server` sends: its (expanded) static `headers`, then its helper's output over them.
 * `config` is the expanded config of the connect; `cwd` the session's project directory.
 */
export async function helperRequestHeaders(
  server: McpServerRecord,
  config: Record<string, unknown>,
  cwd: string,
  opts: { env?: NodeJS.ProcessEnv; home?: string; timeoutMs?: number } = {},
): Promise<RequestHeaders> {
  const fixed = (config.headers as Record<string, string> | undefined) ?? {}
  const command = typeof config.headersHelper === 'string' ? config.headersHelper : undefined
  const from = origin(server.id)
  const url = config.url
  if (!command || !from || typeof url !== 'string') return { headers: fixed, helped: false }
  const pluginRoot =
    from.kind === 'plugin' && typeof config.headersHelperRoot === 'string'
      ? config.headersHelperRoot
      : undefined
  const inProject = from.kind === 'project' || from.kind === 'local'
  const refresh = async () => ({
    ...fixed,
    ...(await runHeadersHelper({
      command,
      serverName: server.name,
      serverUrl: url,
      cwd: pluginRoot ?? (inProject ? cwd : configDirOrHome(opts.home ?? homedir())),
      ...(pluginRoot ? { pluginRoot } : {}),
      stripCredentials: inProject ? from.kind === 'project' : from.kind === 'plugin',
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    })),
  })
  return { headers: await refresh(), helped: true, refresh }
}

/** Claude Code's configuration directory, or the home directory when it does not exist yet. */
function configDirOrHome(home: string): string {
  const dir = claudeConfigDir(home)
  return existsSync(dir) ? dir : home
}
