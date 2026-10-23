// The DNS-rebinding defence for the preview side listeners (static server and injecting proxy).
//
// Both are `Bun.serve` instances outside the API's middleware, so the API's Host allowlist never
// saw their requests. A page whose name re-resolves to 127.0.0.1 reaches them with its OWN name in
// `Host` and becomes same-origin with the listener. The rule is the API's own (loopback names only,
// hostname compared, port ignored), taken from its one owner rather than restated.

import { createLocalOriginPolicy } from '../../../../lib/local-origin-guard'

const loopbackOnly = createLocalOriginPolicy()

/** A 403 for a request whose `Host` is not a loopback name, or `undefined` to serve it. */
export function rejectForeignHost(req: Request): Response | undefined {
  if (loopbackOnly.allowsHost(req.headers.get('host') ?? undefined)) return undefined
  return new Response('Forbidden', { status: 403 })
}

/**
 * Whether a handshake's `Origin` is the listener's own (`http://<loopback name>:<port>`). The proxy
 * relays a WebSocket to its upstream, so a foreign page's handshake must stop here: the upstream
 * cannot judge an Origin the relay does not carry.
 */
export function isOwnLoopbackOrigin(origin: string, port: number): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return (
    url.protocol === 'http:' &&
    url.origin === origin &&
    Number(url.port) === port &&
    loopbackOnly.allowsHost(url.host)
  )
}
