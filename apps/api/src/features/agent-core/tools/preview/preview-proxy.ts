// ─── On-demand injecting reverse proxy (for dev servers we don't serve) ──────
//
// A Vite/Next/etc. dev server is a cross-origin page we can't inject into from
// the host. To enable the element picker WITHOUT touching the project's files,
// we forward the whole dev server through a tiny per-origin proxy on its own
// ephemeral port and inject the probe into HTML responses on the way through —
// the exact server-side analog of how we inject into static files we serve.
// Everything (assets, XHR) forwards same-origin to the proxy, so no CORS. HMR
// websockets ARE proxied too (see the `websocket` relay below), so the proxy is a
// transparent superset of the direct view — hot-reload keeps working while engaged,
// which lets the UI default external dev-server previews to the probe-enabled view.

import { injectProbeIntoHtml } from './probe-inject'
import { createPreviewServerCache } from './preview-server-cache'
import { rejectForeignHost } from './preview-host-guard'
import { websocketRelay, type WsRelay } from './preview-websocket-relay'

export {
  PREVIEW_WS_MAX_QUEUED_FRAMES,
  PREVIEW_WS_MAX_BUFFERED_BYTES,
  previewWsMessageBytes,
  sendOrQueuePreviewWsMessage,
} from './preview-websocket-relay'

/** One proxy server per upstream origin, reused across calls (like the static server). */
const proxyServers = createPreviewServerCache('proxy')

/**
 * The proxy buffers non-GET request bodies once so a forwarded request remains replayable.
 * Bound that allocation at the socket server, before `arrayBuffer()` can materialize it.
 * 32 MiB still accommodates ordinary local dev uploads while rejecting accidental/runaway bodies.
 */
export const PREVIEW_PROXY_MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
])
// Policy headers that would defeat the proxy's whole purpose (embed the page in our
// iframe + inject the inline probe): a strict CSP blocks our inline <script>, and
// X-Frame-Options/frame-ancestors block iframing entirely. Safe to drop for a local
// dev preview we render ourselves.
const FRAME_BLOCKERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
])

/**
 * Build the downstream response headers: drop hop-by-hop + frame-blocking policy
 * headers, but preserve EACH `Set-Cookie` separately. `Headers.forEach`/`get` comma-join
 * multiple Set-Cookie into one string, which corrupts any cookie whose value contains a
 * comma (e.g. an `Expires` date) — breaking auth on a proxied dev preview.
 */
export function forwardProxyHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  upstream.forEach((v, k) => {
    const lk = k.toLowerCase()
    if (lk === 'set-cookie') return // re-added individually below
    if (!HOP_BY_HOP.has(lk) && !FRAME_BLOCKERS.has(lk)) headers.set(k, v)
  })
  for (const cookie of upstream.getSetCookie?.() ?? []) headers.append('set-cookie', cookie)
  return headers
}

function ensureProxyServer(upstreamOrigin: string): number {
  // Upstream ws(s):// origin for HMR — same host, ws↔http / wss↔https.
  const upstreamWsOrigin = upstreamOrigin.replace(/\/$/, '').replace(/^http/, 'ws')
  return proxyServers.ensure(upstreamOrigin, () =>
    Bun.serve<WsRelay>({
      port: 0,
      // Loopback only, for the reason spelled out in `preview-static.ts`: Bun binds `0.0.0.0` by
      // default, and this proxy fronts the user's own dev server.
      hostname: '127.0.0.1',
      maxRequestBodySize: PREVIEW_PROXY_MAX_REQUEST_BODY_BYTES,
      async fetch(req, srv) {
        // Before the upgrade branch too: a rebound page must not get a socket either.
        const foreign = rejectForeignHost(req)
        if (foreign) return foreign
        const reqUrl = new URL(req.url)
        // HMR / any app WebSocket: upgrade here and bridge to the upstream dev server,
        // so hot-reload survives while the page is loaded through the proxy.
        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          const protocol = req.headers.get('sec-websocket-protocol') ?? undefined
          const upgraded = srv.upgrade(req, {
            data: {
              target: upstreamWsOrigin + reqUrl.pathname + reqUrl.search,
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
        const target = upstreamOrigin.replace(/\/$/, '') + reqUrl.pathname + reqUrl.search
        const body =
          req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
        let upstream: Response
        try {
          upstream = await fetch(target, {
            method: req.method,
            headers: req.headers,
            body,
            // Follow redirects INTERNALLY so the browser stays on the proxy origin (a
            // forwarded Location would bounce the iframe back to the probe-less dev server,
            // and `manual` returns an opaque, unreadable redirect anyway).
            redirect: 'follow',
          })
        } catch {
          // Nothing is listening: say so; a reload shows the page once the server is up.
          return new Response(`Preview upstream unreachable: ${upstreamOrigin}`, { status: 502 })
        }
        const headers = forwardProxyHeaders(upstream.headers)
        const ct = upstream.headers.get('content-type') ?? ''
        if (ct.includes('text/html')) {
          const injected = await injectProbeIntoHtml(await upstream.text())
          headers.set('content-type', 'text/html; charset=utf-8')
          return new Response(injected, { status: upstream.status, headers })
        }
        return new Response(upstream.body, { status: upstream.status, headers })
      },
      websocket: websocketRelay,
    }),
  )
}

/**
 * For an external http(s) preview, returns a same-origin proxied URL that serves
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
  const port = ensureProxyServer(u.origin)
  return `http://localhost:${port}${u.pathname}${u.search}`
}

/** Stop every cached injecting-proxy server (idempotent). */
export function disposeProxyServers(): void {
  proxyServers.dispose()
}
