import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import { PRODUCT_NAME, SITE_URL } from '../../../lib/brand'
import type { McpOAuthStore } from './store'

const CLIENT_NAME = PRODUCT_NAME
const CLIENT_URI = SITE_URL

export interface McpOAuthProviderOptions {
  store: McpOAuthStore
  userId: string
  serverId: string
  serverUrl: string
  /** The loopback callback the browser is redirected back to. */
  redirectUrl: string
  /** OAuth `state` parameter for this flow (used to correlate the callback). */
  state: string
  /** Optional pre-registered client credentials (skip dynamic registration). */
  clientId?: string
  clientSecret?: string
  scope?: string
  /** Called with the authorization URL to open in a browser (interactive flow only). */
  onRedirect?: (url: URL) => void
  /**
   * Called with every bearer/refresh/client secret this provider RESOLVES or STORES, so the host can
   * register it with the vault exposure shield.
   *
   * MCP credentials live in their own AES store (`oauth/store.ts`), not the vault, so none of them
   * ever reached `remember` — the shield's three feeders are plugin config, `resolveSecret`, and
   * provider connections. An MCP tool result or error that echoes its own bearer token was therefore
   * persisted into the transcript and streamed verbatim, regardless of token length.
   *
   * Both directions, for the reason the provider-connections fix established: `saveTokens` is what a
   * refresh writes, and that pair is the one in use from that moment on — waiting for the next read
   * leaves the live token unregistered for the rest of the run.
   */
  onSecretResolved?: (value: string) => void
}

/**
 * `OAuthClientProvider` for a remote MCP server, backed by the encrypted
 * {@link McpOAuthStore}. The SDK drives the whole protocol (RFC 9728/8414
 * discovery, dynamic client registration, PKCE, token exchange + refresh) and
 * calls into this provider only to persist/load material and to hand off the
 * authorization URL.
 *
 * Two modes via `onRedirect`:
 *   - INTERACTIVE (a user clicked "Sign in"): `onRedirect` captures the URL so the
 *     caller can open a browser; `redirectToAuthorization` throws afterward via the
 *     SDK's normal `UnauthorizedError`.
 *   - SILENT (a background gather): `onRedirect` is undefined, so we never surface
 *     a URL — the connect just fails with `UnauthorizedError`, marking the server
 *     "needs auth" without popping a browser.
 */
export function createMcpOAuthProvider(opts: McpOAuthProviderOptions): OAuthClientProvider {
  const { store, userId, serverId, serverUrl } = opts
  const note = (value: string | undefined) => {
    if (value) opts.onSecretResolved?.(value)
  }
  const noteTokens = (tokens: OAuthTokens | undefined) => {
    note(tokens?.access_token)
    note(typeof tokens?.refresh_token === 'string' ? tokens.refresh_token : undefined)
  }
  note(opts.clientSecret)

  return {
    get redirectUrl() {
      return opts.redirectUrl
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [opts.redirectUrl],
        client_name: CLIENT_NAME,
        client_uri: CLIENT_URI,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: opts.clientSecret ? 'client_secret_post' : 'none',
        ...(opts.scope ? { scope: opts.scope } : {}),
      }
    },

    state() {
      return opts.state
    },

    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      // Pre-registered credentials win (no dynamic registration needed).
      if (opts.clientId) return { client_id: opts.clientId, client_secret: opts.clientSecret }
      const entry = await store.get(userId, serverId)
      const info = entry?.clientInfo
      if (!info) return undefined
      note(typeof info.client_secret === 'string' ? info.client_secret : undefined)
      // Drop an expired client secret so the SDK re-registers.
      if (
        info.client_secret_expires_at &&
        info.client_secret_expires_at < Math.floor(Date.now() / 1000)
      ) {
        return undefined
      }
      return info
    },

    async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
      note(typeof info.client_secret === 'string' ? info.client_secret : undefined)
      await store.update(userId, serverId, { serverUrl, clientInfo: info })
    },

    async tokens(): Promise<OAuthTokens | undefined> {
      const tokens = (await store.get(userId, serverId))?.tokens
      noteTokens(tokens)
      return tokens
    },

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      noteTokens(tokens)
      // A successful token exchange ends the flow — drop the one-shot code verifier.
      await store.update(userId, serverId, { serverUrl, tokens, codeVerifier: undefined })
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      opts.onRedirect?.(authorizationUrl)
    },

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
      await store.update(userId, serverId, { serverUrl, codeVerifier })
    },

    async codeVerifier(): Promise<string> {
      const v = (await store.get(userId, serverId))?.codeVerifier
      if (!v) throw new Error('No PKCE code verifier saved for this MCP OAuth flow')
      return v
    },
  }
}
