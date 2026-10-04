import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

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

/** The absolute loopback redirect URL registered with the authorization server. */
export function mcpOAuthRedirectUrl(): string {
  return `${resolveRuntimeAddress().baseUrl}${MCP_OAUTH_CALLBACK_PATH}`
}

/** The stored config-carried OAuth overrides (pre-registered client id/secret/scope). */
function oauthConfig(server: McpServerRecord): {
  clientId?: string
  clientSecret?: string
  scope?: string
} {
  const o = (server.config as { oauth?: unknown }).oauth
  if (!o || typeof o !== 'object') return {}
  const c = o as Record<string, unknown>
  return {
    clientId: typeof c.clientId === 'string' ? c.clientId : undefined,
    clientSecret: typeof c.clientSecret === 'string' ? c.clientSecret : undefined,
    scope: typeof c.scope === 'string' ? c.scope : undefined,
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
): OAuthClientProvider | undefined {
  if (server.transport !== 'http') return undefined
  const url = (server.config as { url?: string }).url
  if (!url) return undefined
  return createMcpOAuthProvider({
    store,
    userId: server.userId,
    serverId: server.id,
    serverUrl: url,
    redirectUrl: mcpOAuthRedirectUrl(),
    state: 'silent',
    ...oauthConfig(server),
    onSecretResolved: mcpOAuthSecretSink(server.userId),
    // no onRedirect → silent
  })
}

export { oauthConfig as mcpServerOAuthConfig }
