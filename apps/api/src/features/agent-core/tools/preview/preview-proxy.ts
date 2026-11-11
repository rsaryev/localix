// ─── On-demand injecting reverse proxy (for dev servers we don't serve) ──────
//
// A Vite/Next/etc. dev server is a cross-origin page we can't inject into from
// the host. To enable the element picker WITHOUT touching the project's files,
// we forward the whole dev server through a tiny per-origin proxy on its own
// stable port (below) and inject the probe into HTML responses on the way through —
// the exact server-side analog of how we inject into static files we serve.
// Everything (assets, XHR) forwards same-origin to the proxy, so no CORS. HMR
// websockets ARE proxied too (see the `websocket` relay below), so the proxy is a
// transparent superset of the direct view — hot-reload keeps working while engaged,
// which lets the UI default external dev-server previews to the probe-enabled view.
//
// The proxied page keeps the app's identity: `preview-proxy-headers.ts` holds what is rewritten
// and why. What it cannot keep is the app's ORIGIN — the proxy is another port — so whatever is
// bound to the exact origin (an OAuth `redirect_uri`, a SPA's PKCE verifier in sessionStorage)
// works only in the direct view. See docs/features/visual-feedback.md.

import { injectProbeIntoHtml } from './probe-inject'
import { createPreviewServerCache } from './preview-server-cache'
import { isOwnLoopbackOrigin, rejectForeignHost } from './preview-host-guard'
import { forwardProxyHeaders, upstreamRequestHeaders } from './preview-proxy-headers'
import { listenOnStablePort } from './preview-proxy-listen'
import { websocketRelay, type WsRelay } from './preview-websocket-relay'

/** One proxy server per upstream origin, reused across calls (like the static server). */
const proxyServers = createPreviewServerCache('proxy')

/**
 * The proxy buffers non-GET request bodies once so a forwarded request remains replayable.
 * Bound that allocation at the socket server, before `arrayBuffer()` can materialize it.
 * 32 MiB still accommodates ordinary local dev uploads while rejecting accidental/runaway bodies.
 */
export const PREVIEW_PROXY_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024

/** A response the probe goes into: a document with a body (never a redirect's, nobody sees it). */
const isDocument = (req: Request, res: Response) =>
  req.method !== 'HEAD' && res.status >= 200 && res.status < 300 && res.status !== 204

function ensureProxyServer(upstreamOrigin: string, named: 'localhost' | '127.0.0.1'): number {
  // Upstream ws(s):// origin for HMR — same host, ws↔http / wss↔https.
  const upstreamWsOrigin = upstreamOrigin.replace(/\/$/, '').replace(/^http/, 'ws')
  return proxyServers.ensure(upstreamOrigin, () =>
    listenOnStablePort(upstreamOrigin, named, (hostname, port) =>
      Bun.serve<WsRelay>({
        port,
        // Loopback only, for the reason spelled out in `preview-static.ts`: Bun binds `0.0.0.0` by
        // default, and this proxy fronts the user's own dev server.
        hostname,
        maxRequestBodySize: PREVIEW_PROXY_MAX_REQUEST_BODY_BYTES,
        async fetch(req, srv) {
          // Before the upgrade branch too: a rebound page must not get a socket either.
          const foreign = rejectForeignHost(req)
          if (foreign) return foreign
          const reqUrl = new URL(req.url)
          // HMR / any app WebSocket: upgrade here and bridge to the upstream dev server,
          // so hot-reload survives while the page is loaded through the proxy.
          if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            // A browser always sends Origin on a handshake. Only a page served by THIS proxy may
            // open a relay: the upstream socket cannot carry a foreign page's Origin for the
            // upstream (a Vite HMR server, the Localix API) to judge, so a cross-site handshake
            // would arrive there looking like a trusted non-browser client.
            const browserOrigin = req.headers.get('origin')
            if (browserOrigin !== null && !isOwnLoopbackOrigin(browserOrigin, srv.port!)) {
              return new Response('Forbidden', { status: 403 })
            }
            const protocol = req.headers.get('sec-websocket-protocol') ?? undefined
            const upgraded = srv.upgrade(req, {
              data: {
                target: upstreamWsOrigin + reqUrl.pathname + reqUrl.search,
                // A page served here is the app's own page (see `preview-proxy-headers.ts`); a
                // client that sent no Origin keeps the proxy's, which the upstream does not know.
                origin: browserOrigin === null ? `http://localhost:${srv.port}` : upstreamOrigin,
                protocol,
                queue: [],
                queueBytes: 0,
              },
              // Echo the requested subprotocol so the browser handshake completes (Vite HMR
              // negotiates `vite-hmr`); the upstream socket is opened with the same value.
              headers: protocol
                ? { 'Sec-WebSocket-Protocol': protocol.split(',')[0]!.trim() }
                : undefined,
            })
            if (upgraded) return undefined as unknown as Response // handled by the websocket relay
            return new Response('WebSocket upgrade failed', { status: 400 })
          }
          const target = upstreamOrigin + reqUrl.pathname + reqUrl.search
          const body =
            req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
          let upstream: Response
          try {
            upstream = await fetch(target, {
              method: req.method,
              headers: upstreamRequestHeaders(req.headers, srv.port!, upstreamOrigin),
              body,
              // The browser follows redirects, not the proxy. Following them here served the
              // redirect's target at the URL that was asked for: an OAuth provider's login page
              // re-hosted on the proxy (its relative form posted to the app), a page whose relative
              // scripts resolved one directory too high (a white screen), the cookies set on the
              // redirect lost, and any site the app redirected to re-hosted on a loopback origin
              // with its CSP and X-Frame-Options stripped. `Location` is mapped instead.
              redirect: 'manual',
            })
          } catch {
            // Nothing is listening: say so; a reload shows the page once the server is up.
            return new Response(`Preview upstream unreachable: ${upstreamOrigin}`, { status: 502 })
          }
          const headers = forwardProxyHeaders(upstream.headers, {
            upstream: upstreamOrigin,
            proxy: reqUrl.origin,
          })
          const ct = upstream.headers.get('content-type') ?? ''
          if (ct.includes('text/html') && isDocument(req, upstream)) {
            const injected = await injectProbeIntoHtml(await upstream.text())
            headers.set('content-type', 'text/html; charset=utf-8')
            return new Response(injected, { status: upstream.status, headers })
          }
          return new Response(upstream.body, { status: upstream.status, headers })
        },
        websocket: websocketRelay,
      }),
    ),
  )
}

const LOOPBACK_UPSTREAM_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The proxy answers on the app's own host name, so the two share cookies (`[::1]` is named
 *  `localhost`, which the proxy answers on both loopback addresses). */
const proxyHostname = (upstream: URL) =>
  upstream.hostname === '127.0.0.1' ? ('127.0.0.1' as const) : ('localhost' as const)

/**
 * For a loopback http(s) preview, returns a same-origin proxied URL that serves
 * the dev server with the probe injected — or `undefined` if disabled. The path +
 * query of the original URL are preserved so the right route loads.
 */
export function buildInjectedPreviewUrl(rawUrl: string): string | undefined {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  // Loopback upstreams only (the rule `openPreviewCore` applies). A remote site behind this proxy
  // would be re-hosted on `http://localhost:<port>` with its CSP and X-Frame-Options removed.
  if (!LOOPBACK_UPSTREAM_HOSTS.has(u.hostname)) return undefined
  const named = proxyHostname(u)
  return `http://${named}:${ensureProxyServer(u.origin, named)}${u.pathname}${u.search}`
}

/** Stop every cached injecting-proxy server (idempotent). */
export function disposeProxyServers(): void {
  proxyServers.dispose()
}
