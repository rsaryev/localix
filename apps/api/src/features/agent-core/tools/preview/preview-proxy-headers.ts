// What the preview proxy changes on the way through, and the one rule behind every change.
//
// THE RULE. A page the proxy serves is the upstream app's own page: everything at the proxy's
// origin came from the upstream (redirects are never followed here, so no other site's content is
// ever re-hosted on it). So where the browser names the proxy's origin — `Host`, `Origin`, `Referer`
// — the upstream is told its own name, and where the upstream names its own origin in a `Location`,
// the browser is told the proxy's. Anything else is left exactly as it came: a truly foreign
// `Origin` reaches the app unchanged, and the app's own CSRF check still refuses it; a redirect to
// another site is the browser's to follow.
//
// The proxy's host name is the upstream's (`localhost` fronts `localhost`), so the cookies a page
// sets through it are the app's cookies: browsers scope cookies by host name, not by port. No
// `Set-Cookie` is rewritten.

import { PREVIEW_PROXY_HEADER } from '../../../../lib/local-origin-guard'
import { isOwnLoopbackOrigin } from './preview-host-guard'

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

/** `raw` re-addressed to `origin` when it is a URL of this listener's own origin. */
function fromOwnOrigin(raw: string, port: number, origin: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  return isOwnLoopbackOrigin(url.origin, port) ? origin + url.pathname + url.search : undefined
}

/**
 * The headers a browser's request is forwarded with: addressed to the upstream, `Origin` and
 * `Referer` mapped only when they are this listener's own (`port`), and marked as proxied so the
 * Localix API, which must never answer through a proxy, can tell.
 */
export function upstreamRequestHeaders(incoming: Headers, port: number, upstream: string): Headers {
  const headers = new Headers(incoming)
  headers.set('host', new URL(upstream).host)
  const origin = incoming.get('origin')
  if (origin !== null && isOwnLoopbackOrigin(origin, port)) headers.set('origin', upstream)
  const referer = incoming.get('referer')
  const ownReferer = referer === null ? undefined : fromOwnOrigin(referer, port, upstream)
  if (ownReferer) headers.set('referer', ownReferer)
  headers.set(PREVIEW_PROXY_HEADER, '1')
  return headers
}

/**
 * A redirect's `Location` for the browser: one that points at the upstream's own origin is moved
 * onto `proxyOrigin` (the origin the browser addressed) so the page stays in the preview; a relative
 * one already resolves there, and one that leaves for another site leaves.
 */
export function downstreamLocation(
  location: string,
  upstream: string,
  proxyOrigin: string,
): string {
  let url: URL
  try {
    url = new URL(location)
  } catch {
    return location // relative: the browser resolves it against the proxy's own address
  }
  return url.origin === upstream ? proxyOrigin + url.pathname + url.search + url.hash : location
}

/**
 * Build the downstream response headers: drop hop-by-hop + frame-blocking policy
 * headers, map `Location`, but preserve EACH `Set-Cookie` separately. `Headers.forEach`/`get`
 * comma-join multiple Set-Cookie into one string, which corrupts any cookie whose value contains
 * a comma (e.g. an `Expires` date) — breaking auth on a proxied dev preview.
 */
export function forwardProxyHeaders(
  upstreamHeaders: Headers,
  origins: { upstream: string; proxy: string },
): Headers {
  const headers = new Headers()
  upstreamHeaders.forEach((v, k) => {
    const lk = k.toLowerCase()
    if (lk === 'set-cookie') return // re-added individually below
    if (!HOP_BY_HOP.has(lk) && !FRAME_BLOCKERS.has(lk)) headers.set(k, v)
  })
  for (const cookie of upstreamHeaders.getSetCookie?.() ?? []) headers.append('set-cookie', cookie)
  const location = upstreamHeaders.get('location')
  if (location) {
    headers.set('location', downstreamLocation(location, origins.upstream, origins.proxy))
  }
  return headers
}
