import { join } from 'node:path'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  attemptWithHeadersHelper,
  connectionHeaders,
  HEADERS_HELPER_ORIGINS,
  planHeadersHelper,
  runMcpHeadersHelper,
  type HeadersHelperOrigin,
  type HelperOutput,
} from '@rsaryev/llx-plugin/loading'
import { childEnvNonInteractive } from '../../../../lib/login-shell-env'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import type { McpRemoteRequest } from '../../../mcp/claude-code-settings'
import type { McpServerRecord } from '../../../mcp/repository'
import { hostCommandRunner } from '../ports/command-runner'

/**
 * HOW A REMOTE SERVER IS REACHED, as Claude Code reaches it (mcp.md, "Use dynamic headers for custom
 * authentication"): the kit plans the `headersHelper` (working directory, environment, credentials
 * removed), runs it through Localix's command runner on each connection, merges its headers over the
 * static ones (`connectionHeaders`), and on a call answered 401 or 403 runs it again once and retries
 * (`attemptWithHeadersHelper`); a rejection while connecting fails the connection.
 *
 * Localix glue kept here: which records may run a helper (a plugin's, and a Claude Code file's by
 * its scope; a record of Localix's own registry or a subagent's inline server never does); a
 * project or local server reaches here with its helper only once its folder is trusted
 * (`mcp/claude-code-servers.ts` drops it before), so its trust is the folder's persisted one; and a
 * request to another host, or with a body that cannot be sent twice, is passed through as it is.
 */

const runner = hostCommandRunner({ maxOutputBytes: 1024 * 1024 })
const ORIGINS: ReadonlySet<string> = new Set(HEADERS_HELPER_ORIGINS)

function originOf(id: string): HeadersHelperOrigin | undefined {
  if (id.startsWith('plugin:')) return 'plugin'
  const scope = /^claude-code:([a-z]+):/u.exec(id)?.[1]
  return scope && ORIGINS.has(scope) ? (scope as HeadersHelperOrigin) : undefined
}

const definedOnly = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => !!entry[1]))

/** The helper of `server`, run fresh each call; undefined when it has none or may run none. */
function helperOf(server: McpServerRecord, config: Record<string, unknown>, cwd: string) {
  const origin = originOf(server.id)
  const command = typeof config.headersHelper === 'string' ? config.headersHelper : undefined
  const url = typeof config.url === 'string' ? config.url : undefined
  if (!origin || !command || !url) return undefined
  const plan = planHeadersHelper(
    { name: server.name, url, expandedVariables: [], headersHelper: command },
    origin,
    { source: 'persisted', key: cwd, interactive: true },
    {
      environment: definedOnly(childEnvNonInteractive()),
      locations: { homeDir: () => claudeCodeHome(), joinPath: (base, path) => join(base, path) },
      projectDirectory: cwd,
      primaryDirectory: cwd,
      pluginRoot:
        typeof config.headersHelperRoot === 'string' ? config.headersHelperRoot : undefined,
    },
  )
  if (!plan.run) return undefined
  return (): Promise<HelperOutput> =>
    runMcpHeadersHelper(plan, runner, { signal: new AbortController().signal })
}

/**
 * The headers `server` sends and the fetch that sends them. The headers live in one object the SDK
 * transport reads on every request, so a re-run's headers reach the later requests too; `connected`
 * moves the fetch from the connect rules to the call rules.
 */
export async function remoteRequest(
  server: McpServerRecord,
  config: Record<string, unknown>,
  cwd: string,
  baseFetch: FetchLike,
): Promise<McpRemoteRequest> {
  const fixed = (config.headers as Record<string, string> | undefined) ?? {}
  const helper = helperOf(server, config, cwd)
  const first = helper ? await helper() : { headers: {} }
  if (!('headers' in first)) throw new Error(first.message)
  let dynamic = first.headers
  const merged = connectionHeaders(fixed, dynamic)
  const live: Record<string, string> = { ...merged.headers }
  const origin = typeof config.url === 'string' ? new URL(config.url).origin : undefined
  let phase: 'connect' | 'call' = 'connect'

  const helped: FetchLike = async (input, init) => {
    const target = new URL(input)
    if (
      !helper ||
      target.origin !== origin ||
      (init?.body != null && typeof init.body !== 'string')
    )
      return baseFetch(input, init)
    let rerun = false
    const produce = async (): Promise<HelperOutput> => {
      if (!rerun) return ((rerun = true), { headers: dynamic })
      const fresh = await helper()
      if ('headers' in fresh) {
        dynamic = fresh.headers
        for (const key of Object.keys(live)) delete live[key]
        Object.assign(live, connectionHeaders(fixed, dynamic).headers)
      }
      return fresh
    }
    const send = (over: Record<string, string>) => {
      const headers = new Headers(init?.headers)
      for (const [name, value] of Object.entries(over)) headers.set(name, value)
      return baseFetch(input, { ...init, headers })
    }
    const attempt = await attemptWithHeadersHelper(phase, produce, send, server.name)
    if (attempt.issue) throw new Error(attempt.issue.message)
    return attempt.response ?? baseFetch(input, init)
  }
  return {
    requestInit: Object.keys(live).length > 0 ? { headers: live } : undefined,
    fetch: helped,
    oauthFallback: merged.oauthFallback,
    connected: () => {
      phase = 'call'
    },
  }
}
