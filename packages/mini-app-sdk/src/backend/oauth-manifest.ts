import type { OAuthAdapter, OAuthCredential, OAuthRequestAuth } from './oauth-types'

/**
 * Manifest-driven OAuth-PKCE engine for mini app account connections. A mini app
 * declares the flow as data — authorize/token endpoints, clientId, scopes,
 * parameter names and response-field mappings — and the engine turns it into a
 * runnable `OAuthAdapter` without service-specific host code.
 *
 * Covered: `app-redirect` and `local-server` callback modes, S256 PKCE,
 * JSON/form token exchange with configurable field names, response-field
 * mapping (e.g. OpenRouter returns `key` instead of `access_token`), and
 * refresh-token flows. Device-code flows and provider quirks (split codes,
 * JWT expiry decoding) stay in adapter code.
 */

export interface ManifestOAuthTokenSpec {
  url: string
  /** Body encoding for the exchange request. Default 'json'. */
  format?: 'json' | 'form'
  /** Extra static headers on the token request. */
  headers?: Record<string, string>
  /** Extra static body fields (e.g. `{ "code_challenge_method": "S256" }`). */
  params?: Record<string, string>
  /**
   * Which dynamic fields to send. Default: ['grantType','clientId','code','redirectUri','verifier']
   * when a clientId is declared, else ['code','verifier'].
   */
  include?: Array<'grantType' | 'clientId' | 'code' | 'redirectUri' | 'verifier' | 'state'>
  /** Override the wire names of the dynamic fields. */
  fieldNames?: Partial<
    Record<'grantType' | 'clientId' | 'code' | 'redirectUri' | 'verifier' | 'state', string>
  >
  /** Response field carrying the access token. Default 'access_token'. */
  accessTokenField?: string
  /** Response field carrying the refresh token. Default 'refresh_token'. */
  refreshTokenField?: string
  /** Response field carrying the lifetime in seconds. Default 'expires_in'. */
  expiresInField?: string
  /** Safety margin subtracted from the expiry. Default 300 seconds. */
  expirySkewSeconds?: number
}

export interface ManifestOAuthSpec {
  loginLabel: string
  loginDescription?: string
  /** How the minted credential is sent at request time. Default 'api-key'. */
  requestAuth?: OAuthRequestAuth
  /** Default 'app-redirect'. 'device-code' is NOT supported as data — use adapter code. */
  callbackMode?: 'app-redirect' | 'local-server'
  /** Required when callbackMode === 'local-server'. */
  localServer?: { host: string; port: number; path: string }
  authorize: {
    url: string
    clientId?: string
    /** Joined with a space into the scope parameter. */
    scopes?: string[]
    /** Extra static query params. */
    params?: Record<string, string>
    /** Override the wire names of the dynamic query params. */
    paramNames?: Partial<
      Record<
        | 'redirectUri'
        | 'state'
        | 'challenge'
        | 'challengeMethod'
        | 'clientId'
        | 'scope'
        | 'responseType',
        string
      >
    >
  }
  token: ManifestOAuthTokenSpec
  /**
   * Enable refresh: POSTs `grant_type=refresh_token` (+ clientId when declared)
   * to `url` (default: the token URL) and maps the response like the exchange.
   */
  refresh?: {
    url?: string
    format?: 'json' | 'form'
    headers?: Record<string, string>
    params?: Record<string, string>
  }
}

function fieldValue(obj: Record<string, unknown>, field: string): unknown {
  return obj[field]
}

function toCredential(spec: ManifestOAuthTokenSpec, raw: Record<string, unknown>): OAuthCredential {
  const accessToken = fieldValue(raw, spec.accessTokenField ?? 'access_token')
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error(`OAuth token response carries no "${spec.accessTokenField ?? 'access_token'}"`)
  }
  const refreshRaw = fieldValue(raw, spec.refreshTokenField ?? 'refresh_token')
  const expiresRaw = fieldValue(raw, spec.expiresInField ?? 'expires_in')
  const skewMs = (spec.expirySkewSeconds ?? 300) * 1000
  return {
    accessToken,
    refreshToken: typeof refreshRaw === 'string' && refreshRaw ? refreshRaw : null,
    expiresAt:
      typeof expiresRaw === 'number' && Number.isFinite(expiresRaw)
        ? Date.now() + expiresRaw * 1000 - skewMs
        : null,
  }
}

async function postToken(
  url: string,
  format: 'json' | 'form',
  headers: Record<string, string> | undefined,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  // Cap the token round-trip: a hung exchange/refresh would otherwise block the
  // OAuth connection — and every request waiting on the refreshed credential —
  // indefinitely (no caller-side timeout around these). Mirrors the hand-coded
  // anthropic adapter's TOKEN_TIMEOUT_MS guard.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type':
          format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
        ...headers,
      },
      body: format === 'form' ? new URLSearchParams(fields).toString() : JSON.stringify(fields),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string } | string
      error_description?: string
    }
    const message =
      (typeof body.error === 'object' ? body.error?.message : undefined) ??
      body.error_description ??
      (typeof body.error === 'string' ? body.error : undefined)
    throw new Error(
      message
        ? `${message} (HTTP ${res.status})`
        : `OAuth token request failed (HTTP ${res.status})`,
    )
  }
  const raw = (await res.json()) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('OAuth token response is not an object')
  return raw as Record<string, unknown>
}

/** Build a runnable OAuthAdapter from a pure-data manifest spec. */
/** Loopback hosts, where cleartext is normal and no third party can observe it. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Reject an endpoint a manifest should never have declared.
 *
 * These URLs are untrusted input: a mini app author writes them, and in a marketplace
 * that author is not necessarily the user. Two of them leave the process —
 * `token.url` receives the authorization CODE, and `authorize.url` is handed to the
 * user's browser — so a cleartext hop hands the code to anyone on the path, and a
 * non-network scheme in the authorize slot is script execution or a local read
 * rather than an OAuth endpoint. Checked once at construction, in the same
 * fail-fast style as the `local-server` requirement below, so a broken spec cannot
 * reach a request.
 */
function assertEndpoint(providerId: string, field: string, raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`OAuth spec for "${providerId}": ${field} URL is not a valid URL: ${raw}`)
  }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return
  throw new Error(
    `OAuth spec for "${providerId}": ${field} URL must be https (or http on loopback), got ${url.protocol}//${url.host}`,
  )
}

export function createManifestOAuthAdapter(
  providerId: string,
  spec: ManifestOAuthSpec,
): OAuthAdapter {
  const callbackMode = spec.callbackMode ?? 'app-redirect'
  if (callbackMode === 'local-server' && !spec.localServer) {
    throw new Error(
      `OAuth spec for "${providerId}": callbackMode "local-server" requires "localServer"`,
    )
  }
  assertEndpoint(providerId, 'authorize', spec.authorize.url)
  assertEndpoint(providerId, 'token', spec.token.url)
  if (spec.refresh?.url) assertEndpoint(providerId, 'refresh', spec.refresh.url)
  const tokenFormat = spec.token.format ?? 'json'
  const names = {
    redirectUri: 'redirect_uri',
    state: 'state',
    challenge: 'code_challenge',
    challengeMethod: 'code_challenge_method',
    clientId: 'client_id',
    scope: 'scope',
    responseType: 'response_type',
    ...spec.authorize.paramNames,
  }
  const fieldNames = {
    grantType: 'grant_type',
    clientId: 'client_id',
    code: 'code',
    redirectUri: 'redirect_uri',
    verifier: 'code_verifier',
    state: 'state',
    ...spec.token.fieldNames,
  }
  const include =
    spec.token.include ??
    (spec.authorize.clientId
      ? (['grantType', 'clientId', 'code', 'redirectUri', 'verifier'] as const).slice()
      : (['code', 'verifier'] as const).slice())

  return {
    providerId,
    loginLabel: spec.loginLabel,
    loginDescription: spec.loginDescription ?? '',
    requestAuth: spec.requestAuth ?? 'api-key',
    callbackMode,
    ...(spec.localServer ? { localServer: spec.localServer } : {}),

    buildAuthorizeUrl: ({ state, challenge, appCallbackUrl }) => {
      // Honor the declared loopback host verbatim — some providers (e.g.
      // Spotify) exact-match the registered redirect URI and reject `localhost`
      // when `127.0.0.1` was registered (or vice versa).
      const redirectUri =
        callbackMode === 'local-server'
          ? `http://${spec.localServer!.host}:${spec.localServer!.port}${spec.localServer!.path}`
          : appCallbackUrl
      const params = new URLSearchParams()
      if (spec.authorize.clientId) {
        params.set(names.responseType, 'code')
        params.set(names.clientId, spec.authorize.clientId)
      }
      params.set(names.redirectUri, redirectUri)
      if (spec.authorize.scopes?.length) params.set(names.scope, spec.authorize.scopes.join(' '))
      params.set(names.challenge, challenge)
      params.set(names.challengeMethod, 'S256')
      params.set(names.state, state)
      for (const [k, v] of Object.entries(spec.authorize.params ?? {})) params.set(k, v)
      return { url: `${spec.authorize.url}?${params.toString()}`, redirectUri }
    },

    exchangeCode: async ({ code, verifier, state, redirectUri }) => {
      const dynamic: Record<string, string> = {
        grantType: 'authorization_code',
        clientId: spec.authorize.clientId ?? '',
        code,
        redirectUri,
        verifier,
        state,
      }
      const fields: Record<string, string> = {}
      for (const key of include) fields[fieldNames[key]] = dynamic[key]
      for (const [k, v] of Object.entries(spec.token.params ?? {})) fields[k] = v
      const raw = await postToken(spec.token.url, tokenFormat, spec.token.headers, fields)
      return toCredential(spec.token, raw)
    },

    ...(spec.refresh
      ? {
          refresh: async (refreshToken: string): Promise<OAuthCredential> => {
            const refreshSpec = spec.refresh!
            const fields: Record<string, string> = {
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              ...(spec.authorize.clientId ? { client_id: spec.authorize.clientId } : {}),
              ...refreshSpec.params,
            }
            const raw = await postToken(
              refreshSpec.url ?? spec.token.url,
              refreshSpec.format ?? tokenFormat,
              refreshSpec.headers ?? spec.token.headers,
              fields,
            )
            const credential = toCredential(spec.token, raw)
            // Refresh tokens may not rotate; keep the old one when omitted.
            return { ...credential, refreshToken: credential.refreshToken ?? refreshToken }
          },
        }
      : {}),
  }
}
