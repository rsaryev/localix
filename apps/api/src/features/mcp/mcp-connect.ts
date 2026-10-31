import { mkdirSync } from 'node:fs'
import { errorMessage } from '../../lib/errors'

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { McpServerRecord } from './repository'
import { mcpLaunch } from './mcp-settings-env'
import { resolveConnectTimeoutMs, serverEnv } from './mcp-timeouts'
import { mcpOAuthSession, silentAuthProvider } from './oauth/runtime'
import { remoteRequest } from './mcp-remote-request'
import { createElicitingClient } from './mcp-elicitation'
import { HeadersWebSocketTransport } from './mcp-ws-transport'

// How long a single gather waits for a server to connect before backgrounding it.
// Kept well below typical model prefill so a cold/slow MCP server (e.g. a remote
// HTTP endpoint or a first-time `npx` stdio spawn) never gates the user's turn —
// the connect keeps running and its tools join the next turn. Warm (cached)
// clients resolve far inside this budget, so steady-state turns are unaffected.
export const DEFAULT_CONNECT_BUDGET_MS = 1_500
const CLIENT_NAME = 'localix'
const CLIENT_VERSION = '1.0.0'

/**
 * Stable classification for a remote MCP server that explicitly challenged the
 * client for OAuth. Keeping this distinct from generic connectivity failures is
 * what lets settings offer "Sign in" only when it can actually do something.
 */
export class McpAuthenticationRequiredError extends Error {
  constructor(message = 'MCP server requires authentication') {
    super(message)
    this.name = 'McpAuthenticationRequiredError'
  }
}

export function isMcpAuthenticationRequiredError(error: unknown): boolean {
  return error instanceof UnauthorizedError || error instanceof McpAuthenticationRequiredError
}

/**
 * Await `p` for at most `ms`. Resolves to `p`'s value if it settles in time,
 * else to the `TIMED_OUT` sentinel — WITHOUT aborting `p` (the underlying
 * connect keeps running so the cached entry it populates is reused next turn).
 * A late rejection from an abandoned `p` is swallowed so it never surfaces as an
 * unhandled rejection; a rejection that arrives before the deadline still
 * propagates (the real connect-failure path).
 */
export const TIMED_OUT = Symbol('mcp-connect-timeout')
export function withConnectBudget<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  void p.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/** Build a stdio or http transport for a server record. */
function buildTransport(server: McpServerRecord, cwd: string): Transport {
  const launch = mcpLaunch(server, cwd)
  const config = launch.config
  if (server.transport === 'stdio') {
    const command = (config.command as string[] | undefined) ?? []
    if (command.length === 0) throw new Error('stdio server has no command')
    const [cmd, ...args] = command
    const env = (config.env as Record<string, string> | undefined) ?? undefined
    ensurePluginDataDir(server, env)
    return new StdioClientTransport({
      command: cmd,
      args,
      cwd,
      // The API's environment, the folder's Claude Code settings `env`, CLAUDE_PROJECT_DIR (CC
      // parity: project-relative paths independent of the working directory), then the
      // server's own `env`, which wins (`mcp-settings-env.ts`).
      env: launch.env,
      stderr: 'pipe',
    })
  }
  const url = config.url as string | undefined
  if (!url) throw new Error('http server has no url')
  const headers = (config.headers as Record<string, string> | undefined) ?? undefined
  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: headers ? { headers } : undefined,
  })
}

/**
 * A plugin's `${CLAUDE_PLUGIN_DATA}` "is created when first referenced" (Claude Code's plugin
 * reference): its stdio server is handed the directory, so the directory exists before it starts.
 */
function ensurePluginDataDir(server: McpServerRecord, env: Record<string, string> | undefined) {
  const dir = env?.CLAUDE_PLUGIN_DATA
  if (!server.id.startsWith('plugin:') || !dir) return
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // The server starts all the same; one that needs the directory reports it.
  }
}

/** Connect a client, falling back from Streamable HTTP to SSE for remote servers. */
export async function connectClient(server: McpServerRecord, cwd: string): Promise<Client> {
  // Offers elicitation: the server may ask the person for input during a tool call.
  const client = createElicitingClient({ name: CLIENT_NAME, version: CLIENT_VERSION })
  const deadline = Date.now() + resolveConnectTimeoutMs(serverEnv(server))

  if (server.transport === 'ws') {
    const config = mcpLaunch(server, cwd).config
    const url = config.url as string | undefined
    if (!url) throw new Error('ws server has no url')
    // The configured (expanded) headers go with the upgrade request. OAuth and `headersHelper`
    // are for http servers only, as in Claude Code's documentation.
    const headers = (config.headers as Record<string, string> | undefined) ?? undefined
    await connectTransport(client, new HeadersWebSocketTransport(new URL(url), headers), deadline)
    return client
  }

  if (server.transport === 'http') {
    const config = mcpLaunch(server, cwd).config
    const url = config.url as string | undefined
    if (!url) throw new Error('http server has no url')
    // The static headers with a headersHelper's over them, and the fetch that re-runs the helper
    // after a 401/403 (`mcp-remote-request.ts`). Any helper failure fails this connect.
    const oauth = mcpOAuthSession(server)
    const remote = await remoteRequest(server, config, cwd, oauth.fetch)
    const { requestInit } = remote
    // Attach a SILENT OAuth provider: it uses any stored tokens (refreshing them
    // as needed) but never opens a browser — a server needing auth with no token
    // simply fails with UnauthorizedError (surfaced as "needs auth"). Servers that
    // don't require auth are unaffected (the provider is only invoked on a 401).
    // A helper that supplied `Authorization` is the server's authentication (Claude Code does not
    // fall back to OAuth then), so a rejection is a connect failure, never "needs sign-in".
    const authProvider = remote.authorizedByHelper
      ? undefined
      : silentAuthProvider(server, undefined, oauth)
    try {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit,
        authProvider,
        fetch: remote.fetch,
      })
      await connectTransport(client, transport, deadline)
      return client
    } catch (httpErr) {
      // Older servers only speak the legacy SSE transport — retry once.
      try {
        const sse = new SSEClientTransport(new URL(url), {
          requestInit,
          authProvider,
          fetch: remote.fetch,
        })
        await connectTransport(client, sse, deadline)
        return client
      } catch (sseErr) {
        // Both transports failed: the server is unreachable/misconfigured, NOT just
        // SSE-only. Surface BOTH causes — the primary (HTTP) error is usually the
        // real diagnostic (auth/url), which the generic SSE "fetch failed" otherwise
        // masks (the old empty catch dropped it entirely).
        const http = errorMessage(httpErr)
        const sse = errorMessage(sseErr)
        if (isMcpAuthenticationRequiredError(httpErr) || isMcpAuthenticationRequiredError(sseErr)) {
          throw new McpAuthenticationRequiredError(
            `MCP server requires authentication (http: ${http}; sse: ${sse})`,
          )
        }
        throw new Error(`MCP connect failed (http: ${http}; sse: ${sse})`)
      }
    }
  }

  const transport = buildTransport(server, cwd)
  await connectTransport(client, transport, deadline)
  drainStdioStderr(transport)
  return client
}

/**
 * Bound transport startup and MCP initialize under one per-server deadline.
 * SDK request options cover initialize itself; the outer race also covers a
 * transport whose `start()` never settles. Closing on timeout releases stdio
 * children and HTTP sockets, while the late promise remains rejection-observed.
 */
async function connectTransport(client: Client, transport: Transport, deadline: number) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('MCP startup timeout exhausted before transport fallback')

  let timer: ReturnType<typeof setTimeout> | undefined
  const connect = client.connect(transport, {
    timeout: remaining,
    maxTotalTimeout: remaining,
  })
  void connect.catch(() => {})
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MCP startup timed out after ${remaining}ms`)),
      remaining,
    )
    timer.unref?.()
  })

  try {
    await Promise.race([connect, timeout])
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A stdio transport is built with `stderr: 'pipe'` (see buildTransport) so the
 * child's diagnostics don't pollute our own stderr. But a piped stream that is
 * never READ fills its OS buffer and then BLOCKS the child on its next
 * `write(2)` — a chatty server (progress logs to stderr) deadlocks mid-session.
 * Attach a consumer so the pipe always drains. Best-effort: the SDK exposes
 * `.stderr` only for a stdio transport with pipe; anything else is a no-op.
 */
function drainStdioStderr(transport: Transport): void {
  const stderr = (
    transport as { stderr?: { on?: (event: string, cb: (chunk: unknown) => void) => void } }
  ).stderr
  stderr?.on?.('data', () => {})
}
