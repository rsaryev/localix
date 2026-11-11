import { randomUUID } from 'node:crypto'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'

import { errorMessage } from '../../../lib/errors'
import type { McpServerRecord } from '../repository'
import { claudeCodeMcp } from '../claude-code-settings'
import { mcpLaunch } from '../mcp-settings-env'
import { listenForCallback, type CallbackListener } from './callback-listener'
import { createMcpOAuthProvider } from './provider'
import { createPendingOAuthRegistry } from './pending-flow-registry'
import { mcpOAuthSecretSink, mcpOAuthSession, mcpOAuthStore } from './runtime'
import type { McpOAuthStore } from './store'

/**
 * Interactive OAuth flow orchestration for remote MCP servers.
 *
 * `startAuth` builds a transport with an INTERACTIVE provider and connects: the
 * SDK discovers the authorization server (RFC 9728/8414), dynamically registers a
 * client if needed, generates the PKCE pair, and calls the provider's
 * `redirectToAuthorization` with the URL — which we capture and return so the UI
 * can open a browser. The transport is retained (keyed by the OAuth `state`) so
 * the SAME instance — which holds the discovered endpoints + code verifier — can
 * complete the exchange in `finishAuth` when the browser hits the loopback
 * callback. Pending flows expire after `PENDING_TTL_MS`.
 */

const PENDING_TTL_MS = 10 * 60_000

interface PendingFlow {
  userId: string
  serverId: string
  serverName: string
  transport: { finishAuth(code: string): Promise<void>; close(): Promise<void> }
  client: Client
  expiresAt: number
}

const pending = createPendingOAuthRegistry<PendingFlow>()

export interface StartAuthResult {
  /** The browser URL to open, when authorization is required. */
  authorizationUrl?: string
  /** True when the server was already authorized (valid tokens) — no browser needed. */
  authenticated?: boolean
  /** The OAuth state correlating this flow to its callback. */
  state?: string
}

/**
 * `cwd` is the folder the server was declared in (its project's, as a connect uses): its config is
 * expanded and its `headersHelper` run there, with that folder's settings `env` and
 * `CLAUDE_PROJECT_DIR`, exactly as `connectClient` does (`mcp-settings-env.ts`), never with the API
 * process's own working directory.
 */
export async function startMcpOAuth(
  server: McpServerRecord,
  opts: { cwd: string; store?: McpOAuthStore; nowMs?: number },
): Promise<StartAuthResult> {
  const store = opts.store ?? mcpOAuthStore
  const now = opts.nowMs ?? Date.now()
  pending.sweep(now)
  if (server.transport !== 'http')
    throw new Error('OAuth is only supported for remote (http) MCP servers')
  const config = mcpLaunch(server, opts.cwd).config
  const url = config.url as string | undefined
  if (!url) throw new Error('server has no url')

  const session = mcpOAuthSession(server)
  const remote = await claudeCodeMcp().remoteRequest(server, config, opts.cwd, session.fetch)
  if (!remote.oauthFallback)
    throw new Error(
      'its Authorization header (set or from its headersHelper) is its credential, so there is no sign-in',
    )

  const state = randomUUID()
  let captured: string | undefined
  // A fixed `callbackPort` is received here, for as long as the sign-in is pending.
  const listener: CallbackListener | undefined = session.config.callbackPort
    ? await listenForCallback(session.config.callbackPort, (callbackState, code) =>
        finishMcpOAuth(callbackState, code),
      )
    : undefined
  const provider = createMcpOAuthProvider({
    store,
    userId: server.userId,
    serverId: server.id,
    serverUrl: url,
    redirectUrl: session.redirectUrl,
    state,
    clientId: session.config.clientId,
    clientSecret: session.config.clientSecret,
    scope: session.scope,
    onSecretResolved: mcpOAuthSecretSink(server.userId),
    onRedirect: (u) => {
      captured = u.toString()
    },
  })

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    authProvider: provider,
    requestInit: remote.requestInit,
    fetch: remote.fetch,
  })
  const client = new Client({ name: 'localix', version: '1.0.0' })

  try {
    await client.connect(transport)
    // Connected without an auth challenge → already authorized (or no auth needed).
    await client.close().catch(() => {})
    await listener?.close()
    return { authenticated: true }
  } catch (err) {
    if (err instanceof UnauthorizedError && captured) {
      pending.add(state, {
        userId: server.userId,
        serverId: server.id,
        serverName: server.name,
        // Closing the pending flow closes its listener too.
        transport: listener
          ? {
              finishAuth: (code: string) => transport.finishAuth(code),
              close: async () => {
                await listener.close()
                await transport.close()
              },
            }
          : transport,
        client,
        expiresAt: now + PENDING_TTL_MS,
      })
      return { authorizationUrl: captured, state }
    }
    await client.close().catch(() => {})
    await listener?.close()
    throw new Error(`Could not start MCP OAuth: ${errorMessage(err)}`)
  }
}

export interface FinishAuthResult {
  ok: boolean
  serverId?: string
  serverName?: string
  error?: string
}

export async function finishMcpOAuth(
  state: string,
  code: string,
  nowMs = Date.now(),
): Promise<FinishAuthResult> {
  const flow = pending.take(state, nowMs)
  if (!flow)
    return {
      ok: false,
      error: 'This sign-in link has expired or was already used. Try connecting again.',
    }
  try {
    // finishAuth exchanges the code for tokens on the SAME transport that started
    // the flow; the provider's saveTokens persists them to the encrypted store.
    await flow.transport.finishAuth(code)
    return { ok: true, serverId: flow.serverId, serverName: flow.serverName }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  } finally {
    await flow.transport.close().catch(() => {})
    await flow.client.close().catch(() => {})
  }
}
