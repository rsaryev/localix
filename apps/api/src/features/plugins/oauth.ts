import { randomBytes, createHash } from 'node:crypto'

import { base64url } from '../../lib/base64url'
import { errorMessage } from '../../lib/errors'
import {
  createManifestOAuthAdapter,
  pollDeviceCode,
  type OAuthCredential,
  type PluginOAuth,
} from '@localixai/plugin-sdk/backend'

/**
 * Host implementation of `ctx.oauth` — the {@link PluginOAuth} contract is OWNED
 * by `@localixai/plugin-sdk` (plugins compile against it); this module provides
 * the generic PKCE engine exposed to plugin code so a Spotify/Google/GitHub tool
 * never copy-pastes the verifier/challenge/loopback dance. Pure-data specs
 * (`ManifestOAuthSpec`) drive the flow.
 *
 * Token PERSISTENCE deliberately stays with the plugin (`ctx.stateDir` +
 * `ctx.helpers.readJson/writeJson`) — the host doesn't take custody of
 * third-party credentials beyond the declared `config` secrets.
 */
export type { PluginOAuth } from '@localixai/plugin-sdk/backend'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}
.card{text-align:center;padding:2rem 3rem;background:#1e1e1e;border-radius:1rem;border:1px solid #333}h2{margin:0 0 .5rem}p{margin:0;color:#888;font-size:.9rem}</style></head>
<body><div class="card"><h2>✓ Connected!</h2><p>You can close this tab and return to LocalixAI.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

export function makePluginOAuth(pluginName: string): PluginOAuth {
  return {
    beginLogin(spec, opts) {
      if (spec.callbackMode !== 'local-server' || !spec.localServer) {
        throw new Error(
          `[plugin:${pluginName}] beginLogin requires callbackMode 'local-server' with a localServer {host, port, path}`,
        )
      }
      const adapter = createManifestOAuthAdapter(`plugin:${pluginName}`, spec)
      const state = base64url(randomBytes(24))
      const verifier = base64url(randomBytes(32))
      const challenge = base64url(createHash('sha256').update(verifier).digest())
      const { url, redirectUri } = adapter.buildAuthorizeUrl!({
        state,
        verifier,
        challenge,
        appCallbackUrl: '',
      })

      let settle: { resolve: (c: OAuthCredential) => void; reject: (e: Error) => void }
      const credential = new Promise<OAuthCredential>((resolve, reject) => {
        settle = { resolve, reject }
      })
      // Swallow "nobody awaited yet" rejections (cancel before the tool awaits).
      credential.catch(() => {})

      const { host, port, path } = spec.localServer
      let server: ReturnType<typeof Bun.serve> | null = null
      // Graceful by default — a force-stop inside the request handler would cut
      // the very response being delivered to the user's browser tab.
      const stop = (force = false) => {
        void server?.stop(force)
        server = null
        clearTimeout(timer)
      }
      const timer = setTimeout(() => {
        stop(true)
        settle.reject(new Error('OAuth login timed out — the authorization was never completed'))
      }, opts?.timeoutMs ?? LOGIN_TIMEOUT_MS)
      timer.unref?.()

      server = Bun.serve({
        hostname: host,
        port,
        async fetch(req) {
          const u = new URL(req.url)
          if (u.pathname !== path) return new Response('Not found', { status: 404 })
          const err = u.searchParams.get('error')
          if (err) {
            stop()
            settle.reject(new Error(`OAuth authorization denied: ${err}`))
            return new Response('Authorization denied. You can close this tab.', { status: 200 })
          }
          const code = u.searchParams.get('code')
          // One-shot CSRF guard: the callback must echo OUR state.
          if (!code || u.searchParams.get('state') !== state) {
            return new Response('Invalid callback', { status: 400 })
          }
          try {
            const cred = await adapter.exchangeCode!({ code, verifier, state, redirectUri })
            settle.resolve(cred)
            return new Response(SUCCESS_HTML, { headers: { 'content-type': 'text/html' } })
          } catch (e) {
            const detail = errorMessage(e)
            settle.reject(e instanceof Error ? e : new Error(detail))
            return new Response(`Token exchange failed: ${detail}`, {
              status: 502,
            })
          } finally {
            stop()
          }
        },
      })

      return {
        authorizeUrl: url,
        credential,
        cancel() {
          stop(true)
          settle.reject(new Error('OAuth login cancelled'))
        },
      }
    },

    async refresh(spec, refreshToken) {
      const adapter = createManifestOAuthAdapter(`plugin:${pluginName}`, spec)
      if (!adapter.refresh) {
        throw new Error(`[plugin:${pluginName}] spec declares no refresh config`)
      }
      return adapter.refresh(refreshToken)
    },

    pollDeviceCode,
  }
}
