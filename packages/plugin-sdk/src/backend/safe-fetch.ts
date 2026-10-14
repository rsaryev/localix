/**
 * An SSRF-safe `fetch` for plugin backends.
 *
 * `checkUrlSafety` reasons about ONE url. `fetch` follows redirects by default, so
 * the obvious composition — check the url, then fetch it — leaves the hole the check
 * was written to close: a public host under someone else's control answers `302
 * Location: http://169.254.169.254/…` (or `127.0.0.1`, or a LAN address) and the
 * guard never sees the address actually contacted. Demonstrated against real local
 * servers in `safe-fetch.test.ts`.
 *
 * The core's web-fetch tool already follows redirects manually for exactly this
 * reason — see `apps/api/src/features/agent-core/tools/web/research-fetch.ts`, "Follow
 * redirects manually so EVERY hop passes the SSRF check". This is the same rule
 * packaged for plugins, so nobody has to rediscover it, and the SDK's obvious usage
 * is the safe one.
 *
 * Not a policy decision about WHAT a plugin may reach: a host with a legitimate need
 * for internal targets passes its own `resolve`, exactly as `checkUrlSafety` allows.
 */

import { checkUrlSafety, type HostResolver } from './net-safety'

export interface SafeFetchOptions extends RequestInit {
  /** Host resolver, injectable for tests; defaults to `node:dns` via checkUrlSafety. */
  resolve?: HostResolver
  /**
   * The per-hop verdict: an error string, or null when the url may be contacted.
   * Defaults to {@link checkUrlSafety}. Injectable for the same reason the core's
   * web-fetch injects `resolveHost` — an IP literal never consults the resolver, so
   * a loopback test server cannot otherwise exercise the REDIRECT with the real
   * policy in place. A host with a legitimate need for internal targets can also
   * substitute its own policy here.
   */
  check?: (url: URL) => Promise<string | null>
  /** Redirect hops to follow before giving up. */
  maxRedirects?: number
}

export type SafeFetchResult =
  | { ok: true; response: Response; url: string }
  | { ok: false; error: string }

/** Schemes a plugin may fetch. `file:`/`data:`/`blob:` are not network reads. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

const DEFAULT_MAX_REDIRECTS = 5

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const { resolve, check, maxRedirects = DEFAULT_MAX_REDIRECTS, ...init } = options
  const verdict = check ?? ((url: URL) => checkUrlSafety(url, resolve))

  let current: URL
  try {
    current = new URL(String(input))
  } catch {
    return { ok: false, error: `Not a valid URL: ${String(input)}` }
  }

  for (let hop = 0; ; hop++) {
    if (!ALLOWED_PROTOCOLS.has(current.protocol)) {
      return { ok: false, error: `Unsupported protocol: ${current.protocol}` }
    }
    const unsafe = await verdict(current)
    if (unsafe) return { ok: false, error: unsafe }

    // `redirect: 'manual'` is what makes the loop above meaningful — with the
    // default, fetch would have followed the hop before we could inspect it.
    const response = await fetch(current, { ...init, redirect: 'manual' })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return { ok: true, response, url: current.href }
    }
    if (hop >= maxRedirects) {
      return { ok: false, error: `Too many redirects (>${maxRedirects}) from ${String(input)}` }
    }
    try {
      current = new URL(location, current)
    } catch {
      return { ok: false, error: `Redirected to an unparseable location: ${location}` }
    }
  }
}
