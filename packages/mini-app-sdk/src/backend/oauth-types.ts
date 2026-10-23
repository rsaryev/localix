/**
 * Generic OAuth contracts used by the plugin SDK's account-connection helper.
 * Concrete flows are supplied as DATA (a manifest spec consumed by the engine
 * in `oauth-manifest.ts`); the host generates state/PKCE and runs the loopback
 * callback or device-code polling without coupling plugins to a provider SDK.
 */

/** Credential returned by an OAuth exchange/refresh. Static-key providers return only accessToken. */
export interface OAuthCredential {
  accessToken: string
  refreshToken?: string | null
  /** Unix epoch ms when the access token expires; null/undefined = never (static key). */
  expiresAt?: number | null
}

/** How the resulting token is later sent to the provider at request time. */
export type OAuthRequestAuth = 'api-key' | 'oauth'

/**
 * How the OAuth flow returns control:
 * - app-redirect: provider redirects back to our app URL; UI submits code+state.
 * - local-server: provider redirects to a fixed loopback URI we listen on; completes server-side.
 * - device-code: RFC 8628 — show the user a code to enter at a verification URL; poll for the token.
 */
export type OAuthCallbackMode = 'app-redirect' | 'local-server' | 'device-code'

/** Result of starting an RFC 8628 device-code flow. */
export interface DeviceFlowStart {
  /** Opaque device code used to poll for the token. */
  deviceCode: string
  /** Code the user types at the verification URL. */
  userCode: string
  /** URL the user opens to enter the code. */
  verificationUri: string
  intervalSeconds?: number
  expiresInSeconds: number
}

export interface BuildAuthorizeUrlArgs {
  /** CSRF state we generated. */
  state: string
  /** PKCE code verifier we generated (raw). */
  verifier: string
  /** PKCE S256 challenge derived from verifier. */
  challenge: string
  /** For 'app-redirect' adapters: the URL our app is reachable at (caller-provided). Ignored by 'local-server' adapters which use their own fixed redirect URI. */
  appCallbackUrl: string
}

export interface ExchangeCodeArgs {
  code: string
  verifier: string
  /** The CSRF state from the authorize step (some providers require it in the exchange). */
  state: string
  /** The exact redirect_uri used in the authorize step (must match for the token exchange). */
  redirectUri: string
}

export interface OAuthAdapter {
  providerId: string
  /** Short label for the OAuth login button (e.g. "Subscription (Claude Pro/Max)"). */
  loginLabel: string
  /** One-line explanation of what this login uses / how it's billed. */
  loginDescription: string
  /** Whether the resulting token is used as api-key or oauth (Bearer + special headers) at request time. */
  requestAuth: OAuthRequestAuth
  callbackMode: OAuthCallbackMode
  /** Only for callbackMode==='local-server': the fixed loopback redirect target the provider requires. */
  localServer?: { host: string; port: number; path: string }
  /** Build the provider authorize URL + the redirect_uri (redirect-based modes only). */
  buildAuthorizeUrl?: (args: BuildAuthorizeUrlArgs) => { url: string; redirectUri: string }
  /** Exchange an authorization code for a credential (redirect-based modes only). */
  exchangeCode?: (args: ExchangeCodeArgs) => Promise<OAuthCredential>
  /** Start a device-code flow (callbackMode==='device-code'). */
  startDeviceFlow?: () => Promise<DeviceFlowStart>
  /** Poll until the device flow completes, returning the credential (callbackMode==='device-code'). */
  pollDeviceFlow?: (
    deviceCode: string,
    expiresInSeconds: number,
    intervalSeconds?: number,
    signal?: AbortSignal,
  ) => Promise<OAuthCredential>
  /** Refresh an access token (only OAuth providers with refresh tokens). */
  refresh?: (refreshToken: string) => Promise<OAuthCredential>
}
