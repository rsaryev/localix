import type { ManifestOAuthSpec } from './oauth-manifest'
import type { OAuthCredential } from './oauth-types'
import type { pollDeviceCode } from './oauth-device-code'

export type { ManifestOAuthSpec } from './oauth-manifest'
export type { OAuthCredential } from './oauth-types'

/**
 * OAuth socket for mini apps (`ctx.oauth`) — a generic PKCE engine exposed to
 * mini app code so a Spotify/Google/GitHub tool never copy-pastes the
 * verifier/challenge/loopback dance. Pure-data specs (`ManifestOAuthSpec`) drive
 * the flow.
 *
 * Token PERSISTENCE deliberately stays with the mini app (`ctx.stateDir` +
 * `ctx.helpers.readJson/writeJson`) — the host doesn't take custody of
 * third-party credentials beyond the declared `config` secrets.
 */

/** A login in flight: hand `authorizeUrl` to the user, await `credential`. */
export interface MiniAppOAuthLogin {
  /** URL the user opens in a browser to authorize. */
  authorizeUrl: string
  /** Resolves when the loopback callback completes the code exchange; rejects on timeout/cancel/denial. */
  credential: Promise<OAuthCredential>
  /** Abort the login: stops the loopback server and rejects `credential`. */
  cancel(): void
}

export interface MiniAppOAuth {
  /**
   * Begin a local-loopback PKCE login. The spec must declare
   * `callbackMode: 'local-server'` + `localServer: { host, port, path }` —
   * the host generates state/PKCE, starts a ONE-SHOT listener there, and
   * exchanges the code server-side. `host` must be a loopback address
   * (`127.0.0.1`, `localhost` or `::1`). Default timeout 5 minutes.
   */
  beginLogin(spec: ManifestOAuthSpec, opts?: { timeoutMs?: number }): MiniAppOAuthLogin
  /** Refresh an access token via the spec's `refresh` config. */
  refresh(spec: ManifestOAuthSpec, refreshToken: string): Promise<OAuthCredential>
  /** RFC 8628 device-code polling helper (for specs/adapters using device flows). */
  pollDeviceCode: typeof pollDeviceCode
}
