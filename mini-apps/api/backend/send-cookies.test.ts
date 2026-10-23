/**
 * The `cookies` facet on a send: what the FINAL response asked the client to store, parsed from its
 * `Set-Cookie` headers. Distinct from the send-time jar (cookie-jar.ts) that carries cookies across
 * a redirect chain and is then dropped — this is the summary the workbench shows.
 *
 * `fetch` is stubbed the same way send.test.ts stubs it: cookies are `append`-ed one Set-Cookie
 * line per cookie, because the whole reason the code reads `getSetCookie()` is that folding them
 * into one comma-joined string is lossy.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { sendRequest } from './send'
import type { RequestSpec } from './request-spec'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/end',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const OPTS = {
  timeoutMs: 5_000,
  maxBodyBytes: 100_000,
  allowPrivateNetwork: false,
  // Every test host is public; a stub keeps the address check off real DNS.
  resolveHost: async () => ['93.184.216.34'],
}

/** A fetch answering `routes`, one appended Set-Cookie line per entry. */
function stubFetch(
  routes: Record<string, { status: number; location?: string; setCookie?: string[] }>,
) {
  globalThis.fetch = (async (input: URL | string) => {
    const url = input.toString()
    const route = routes[url] ?? routes[url.replace(/\?$/, '')] ?? { status: 200 }
    const headers = new Headers(route.location ? { location: route.location } : {})
    for (const c of route.setCookie ?? []) headers.append('set-cookie', c)
    return new Response(route.status >= 300 && route.status < 400 ? null : 'ok', {
      status: route.status,
      headers,
    })
  }) as typeof fetch
}

describe('the cookies facet', () => {
  test('parses MULTIPLE Set-Cookie headers off the final response', async () => {
    stubFetch({
      'https://api.dev/end': {
        status: 200,
        setCookie: ['session=abc123; Path=/; HttpOnly', 'theme=dark; Path=/'],
      },
    })
    const res = await sendRequest(spec(), OPTS)
    expect(res.cookies).toEqual([
      { name: 'session', value: 'abc123' },
      { name: 'theme', value: 'dark' },
    ])
  })

  test('reads the LAST hop only — a login is summarised by the session it ends holding', async () => {
    stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://api.dev/dashboard',
        setCookie: ['session=set-on-redirect; Path=/'],
      },
      'https://api.dev/dashboard': { status: 200, setCookie: ['final=here; Path=/'] },
    })
    const res = await sendRequest(spec({ url: 'https://api.dev/login', method: 'POST' }), OPTS)
    // The redirect's own Set-Cookie fed the jar; the FACET is the final hop's.
    expect(res.cookies).toEqual([{ name: 'final', value: 'here' }])
  })

  test('a response that sets no cookies carries no facet at all', async () => {
    stubFetch({ 'https://api.dev/end': { status: 200 } })
    const res = await sendRequest(spec(), OPTS)
    expect(res.cookies).toBeUndefined()
  })

  test('a Max-Age=0 deletion is not surfaced as a stored cookie', async () => {
    stubFetch({
      'https://api.dev/end': {
        status: 200,
        setCookie: ['gone=; Max-Age=0', 'kept=yes; Path=/'],
      },
    })
    const res = await sendRequest(spec(), OPTS)
    expect(res.cookies).toEqual([{ name: 'kept', value: 'yes' }])
  })
})

describe('hops carry per-hop status now', () => {
  test('a redirect chain reports each hop as {url,status,elapsedMs}', async () => {
    stubFetch({
      'https://api.dev/login': { status: 302, location: 'https://api.dev/dashboard' },
      'https://api.dev/dashboard': { status: 200 },
    })
    const res = await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(res.hops.map((h) => h.status)).toEqual([302, 200])
    expect(res.hops.map((h) => h.url)).toEqual([
      'https://api.dev/login',
      'https://api.dev/dashboard',
    ])
    for (const hop of res.hops) expect(typeof hop.elapsedMs).toBe('number')
  })
})
