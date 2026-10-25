import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

import { resolveRuntimeAddress } from '../../../lib/runtime-address'
import type { McpServerRecord } from '../repository'
import { createMcpOAuthProvider } from './provider'
import { createMcpOAuthStore, type McpOAuthStore } from './store'

/** The route the OAuth authorization server redirects back to (loopback). */
export const MCP_OAUTH_CALLBACK_PATH = '/rpc/mcp/oauth/callback'

/** Process-lifetime encrypted store, shared by the silent connect path + the flow. */
export const mcpOAuthStore: McpOAuthStore = createMcpOAuthStore()

/**
 * Observer for every MCP OAuth secret a provider resolves or stores, registered ONCE by the
 * composition root (`bootstrap`) with the vault exposure shield's `remember`.
 *
 * A module-level registration rather than a constructor argument because `mcpOAuthStore` above and
 * both provider construction sites (`silentAuthProvider` here, the interactive `flow.ts`) are
 * process-lifetime module functions that no dependency graph reaches. The alternative — threading a
 * shield through every MCP call site — would put the same policy in two places and leave a third free
 * to forget it.
 */
let secretObserver: ((userId: string, value: string) => void) | undefined

export function observeMcpOAuthSecrets(observe: (userId: string, value: string) => void): void {
  secretObserver = observe
}

/** The per-provider callback: bound to one user, ignores an absent observer and empty values. */
export function mcpOAuthSecretSink(userId: string): ((value: string) => void) | undefined {
  return secretObserver ? (value: string) => secretObserver?.(userId, value) : undefined
}

/**
 * The absolute loopback redirect URL registered with the authorization server: the API's own
 * callback route, or, for a server that fixes `oauth.callbackPort` as Claude Code does, the
 * `http://localhost:PORT/callback` its authorization server was told (`callback-listener.ts`).
 */
export function mcpOAuthRedirectUrl(callbackPort?: number): string {
  if (callbackPort) return `http://localhost:${callbackPort}/callback`
  return `${resolveRuntimeAddress().baseUrl}${MCP_OAUTH_CALLBACK_PATH}`
}

/** The config-carried OAuth settings: a pre-registered client, a scope, a port, a metadata URL. */
function oauthConfig(server: McpServerRecord): {
  clientId?: string
  clientSecret?: string
  scope?: string
  callbackPort?: number
  authServerMetadataUrl?: string
} {
  const o = (server.config as { oauth?: unknown }).oauth
  if (!o || typeof o !== 'object') return {}
  const c = o as Record<string, unknown>
  return {
    clientId: typeof c.clientId === 'string' ? c.clientId : undefined,
    clientSecret: typeof c.clientSecret === 'string' ? c.clientSecret : undefined,
    scope: typeof c.scope === 'string' && c.scope.trim() ? c.scope.trim() : undefined,
    callbackPort:
      typeof c.callbackPort === 'number' && Number.isInteger(c.callbackPort) && c.callbackPort > 0
        ? c.callbackPort
        : undefined,
    authServerMetadataUrl:
      typeof c.authServerMetadataUrl === 'string' ? c.authServerMetadataUrl : undefined,
  }
}

/** Whether `url` is where an authorization server's metadata is looked up (RFC 8414 / OIDC). */
function isMetadataDiscovery(url: URL): boolean {
  return (
    url.pathname.includes('/.well-known/oauth-authorization-server') ||
    url.pathname.includes('/.well-known/openid-configuration')
  )
}

/**
 * What a server's OAuth sign-in is configured with, shared by the silent and the interactive
 * provider so both register and use the same redirect and scope:
 *
 *   - `redirectUrl`: the fixed `callbackPort`'s, else the API's own callback.
 *   - `fetch`: the SDK's discovery goes through it. A configured `authServerMetadataUrl` replaces
 *     the metadata lookup (Claude Code: it overrides the default discovery chain), and the
 *     metadata's `scopes_supported` is noted whichever document it came from.
 *   - `scope()`: `oauth.scopes` when pinned, else the configured metadata URL's `scopes_supported`;
 *     `offline_access` is appended when the authorization server lists it, so a token can refresh.
 */
export function mcpOAuthSession(server: McpServerRecord, baseFetch: FetchLike = fetch) {
  const config = oauthConfig(server)
  let supported: string[] | undefined
  const sessionFetch: FetchLike = async (input, init) => {
    const target = new URL(input)
    if (!isMetadataDiscovery(target)) return baseFetch(input, init)
    const response = await baseFetch(config.authServerMetadataUrl ?? input, init)
    if (response.ok) {
      try {
        const metadata = (await response.clone().json()) as { scopes_supported?: unknown }
        if (Array.isArray(metadata.scopes_supported))
          supported = metadata.scopes_supported.filter((s): s is string => typeof s === 'string')
      } catch {
        // Not JSON: the SDK reports the bad document itself.
      }
    }
    return response
  }
  const scope = (): string | undefined => {
    const base = config.scope ?? (config.authServerMetadataUrl ? supported?.join(' ') : undefined)
    if (!base) return undefined
    const has = base.split(/\s+/).includes('offline_access')
    return supported?.includes('offline_access') && !has ? `${base} offline_access` : base
  }
  return {
    config,
    redirectUrl: mcpOAuthRedirectUrl(config.callbackPort),
    fetch: sessionFetch,
    scope,
  }
}

/**
 * A SILENT auth provider for a remote server, used on the normal connect path.
 * It loads stored tokens (and refreshes them) but never opens a browser: with no
 * `onRedirect`, a 401 with no valid token surfaces as `UnauthorizedError`, marking
 * the server "needs auth" instead of interrupting a turn. Returns undefined for
 * non-remote transports (OAuth is HTTP/SSE only) so nothing changes for stdio/ws.
 */
export function silentAuthProvider(
  server: McpServerRecord,
  store: McpOAuthStore = mcpOAuthStore,
  session = mcpOAuthSession(server),
): OAuthClientProvider | undefined {
  if (server.transport !== 'http') return undefined
  const url = (server.config as { url?: string }).url
  if (!url) return undefined
  return createMcpOAuthProvider({
    store,
    userId: server.userId,
    serverId: server.id,
    serverUrl: url,
    redirectUrl: session.redirectUrl,
    state: 'silent',
    clientId: session.config.clientId,
    clientSecret: session.config.clientSecret,
    scope: session.scope,
    onSecretResolved: mcpOAuthSecretSink(server.userId),
    // no onRedirect → silent
  })
}
