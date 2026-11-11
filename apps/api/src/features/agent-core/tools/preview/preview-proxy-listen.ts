// Where a preview proxy listens: a STABLE loopback port per upstream, on every address its URL
// can resolve to.
//
// STABLE. A page's localStorage, sessionStorage and IndexedDB belong to its origin, port included;
// an ephemeral port gave the proxied app a new origin on every API start, so a preview forgot
// everything it stored each time (a SPA's sign-in token with it). The port is derived from the
// upstream origin instead, so the same app gets the same port across restarts. The range is in the
// IANA dynamic range and above Linux's ephemeral one (32768–60999), where no registered service
// listens. A taken port moves to the next few candidates, then to any free port: the origin changes
// only then, and the app's cookies still apply, because the host name stays the app's.
//
// EVERY ADDRESS. An explicit port can be held by another process on another address — a wildcard
// `*:P` listener (macOS's own daemons have them in this range) does not stop a bind to
// `127.0.0.1:P`, and `localhost` may resolve to `::1` first, where the browser would reach that
// process instead of the proxy. A `localhost` proxy therefore also binds `[::1]:P`: the most specific
// bind wins over a wildcard one on both families, and a process holding either address exactly
// makes the candidate taken. An ephemeral port never had this problem, because the kernel picks one
// free on every address.

import { createHash } from 'node:crypto'

const STABLE_PORT_BASE = 61000
const STABLE_PORT_SPAN = 4000
const STABLE_PORT_TRIES = 8

type Listener = Pick<ReturnType<typeof Bun.serve>, 'port' | 'stop'>

/** The ports a proxy for `upstreamOrigin` tries, in order, before any free one. */
export function preferredProxyPorts(upstreamOrigin: string): number[] {
  const start = createHash('sha256').update(upstreamOrigin).digest().readUInt32BE(0)
  return Array.from(
    { length: STABLE_PORT_TRIES },
    (_, i) => STABLE_PORT_BASE + ((start + i) % STABLE_PORT_SPAN),
  )
}

let ipv6Loopback: boolean | undefined
/** Whether this machine has `::1` at all (a host with IPv6 disabled resolves `localhost` to v4). */
function hasIpv6Loopback(): boolean {
  if (ipv6Loopback === undefined) {
    try {
      const probe = Bun.serve({ port: 0, hostname: '::1', fetch: () => new Response(null) })
      void probe.stop(true)
      ipv6Loopback = true
    } catch {
      ipv6Loopback = false
    }
  }
  return ipv6Loopback
}

function both(v4: Listener, v6: Listener | undefined): Listener {
  return {
    port: v4.port,
    // Both at once: a proxy restarted right after (the cache's dispose, then `ensure`) rebinds the
    // same port, and an address still bound would push it onto another one.
    stop: (force?: boolean) => Promise.all([v4.stop(force), v6?.stop(force)]).then(() => undefined),
  }
}

/** Bind `127.0.0.1:port` (and `[::1]:port` when `dualStack`), or throw when either is taken. */
function bindAt(port: number, dualStack: boolean, serve: (h: string, p: number) => Listener) {
  const v4 = serve('127.0.0.1', port)
  if (!dualStack) return v4
  try {
    return both(v4, serve('::1', v4.port!))
  } catch (error) {
    void v4.stop(true)
    throw error
  }
}

/**
 * Start the proxy for `upstreamOrigin` on its stable port. `named` is the host name its URL will
 * carry: `localhost` is answered on both loopback addresses, a literal on itself.
 */
export function listenOnStablePort(
  upstreamOrigin: string,
  named: 'localhost' | '127.0.0.1',
  serve: (hostname: string, port: number) => Listener,
): Listener {
  const dualStack = named === 'localhost' && hasIpv6Loopback()
  for (const port of preferredProxyPorts(upstreamOrigin)) {
    try {
      return bindAt(port, dualStack, serve)
    } catch {
      /* taken on one of the addresses: the next candidate */
    }
  }
  // Any free port: the kernel picks one free on 127.0.0.1; `::1` beside it is best effort.
  try {
    return bindAt(0, dualStack, serve)
  } catch {
    return serve('127.0.0.1', 0)
  }
}
