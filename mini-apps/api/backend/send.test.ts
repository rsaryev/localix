/**
 * `sendRequest` — the redirect chain and its guards.
 *
 * This file exists because a review found that the single most security-critical module in the
 * mini app had NO test. Its header made four emphatic claims — every hop is guarded, credentials do
 * not survive a cross-origin hop, a 303 becomes a GET, redirects are bounded — and not one of them
 * would have failed if the code had regressed. Prose is not a guard.
 *
 * `fetch` is stubbed rather than mocked away: the stub answers redirects so the real loop, the real
 * guard and the real header handling all run. What is faked is the network, not the logic.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { RequestTimeoutError, sendRequest } from './send'
import type { RequestSpec } from './request-spec'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/start',
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

/** The message `sendRequest` refused with, or '' when it did not refuse. */
async function refusal(spec: RequestSpec, opts = OPTS): Promise<string> {
  try {
    await sendRequest(spec, opts)
    return ''
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** A fetch that answers each url from `routes`, recording every call. */
function stubFetch(
  routes: Record<
    string,
    { status: number; location?: string; body?: string; setCookie?: string[] }
  >,
) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = input.toString()
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    })
    const route = routes[url] ?? routes[url.replace(/\?$/, '')] ?? { status: 200, body: 'ok' }
    const headers = new Headers(route.location ? { location: route.location } : {})
    // `append`, never `set`: a real response carries one Set-Cookie line per cookie, and the whole
    // reason the jar reads `getSetCookie()` is that folding them into one string is lossy.
    for (const c of route.setCookie ?? []) headers.append('set-cookie', c)
    return new Response(route.status >= 300 && route.status < 400 ? null : (route.body ?? 'ok'), {
      status: route.status,
      headers,
    })
  }) as typeof fetch
  return calls
}

describe('every hop passes the SSRF guard', () => {
  test('a redirect to a private address is REFUSED, after a public first hop', async () => {
    // The attack the module header names: a public host answering `302 → 169.254.169.254` is the
    // standard way to turn an outbound request into a read of the cloud metadata service. `fetch`'s
    // own redirect handling would check only the first url, which is why the loop is manual.
    stubFetch({
      'https://api.dev/start': {
        status: 302,
        location: 'http://169.254.169.254/latest/meta-data/',
      },
    })
    expect(await refusal(spec())).toMatch(/private\/internal address/)
  })

  test('a redirect to localhost is refused too', async () => {
    stubFetch({ 'https://api.dev/start': { status: 302, location: 'http://localhost:8080/admin' } })
    expect(await refusal(spec())).toMatch(/local machine/)
  })

  test('the FIRST hop is guarded as well', async () => {
    stubFetch({})
    expect(await refusal(spec({ url: 'http://127.0.0.1/x' }))).toMatch(/private\/internal/)
  })

  test('a public → public redirect is followed', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://api.dev/moved' },
      'https://api.dev/moved': { status: 200, body: 'arrived' },
    })
    const res = await sendRequest(spec(), OPTS)
    expect(res.body).toBe('arrived')
    expect(calls.map((c) => c.url)).toEqual(['https://api.dev/start', 'https://api.dev/moved'])
    expect(res.hops).toHaveLength(2)
  })
})

describe('a scheme other than http(s) is refused, whatever the setting', () => {
  test.each([true, false])('allowPrivateNetwork=%p still refuses file://', async (allowPrivate) => {
    // `checkUrlSafety` reasons about hostnames only, so it calls `file:///etc/passwd` SAFE — the
    // hostname is empty, the DNS lookup throws, and its catch returns null. Bun's fetch then reads
    // the file. ALLOW_PRIVATE_NETWORK is about reaching your own LAN and must not enable this.
    stubFetch({})
    expect(
      await refusal(spec({ url: 'file:///etc/passwd' }), {
        ...OPTS,
        allowPrivateNetwork: allowPrivate,
      }),
    ).toMatch(/http\(s\) only/)
  })

  test('allowPrivateNetwork DOES still allow a private http host', async () => {
    // The setting must keep working for what it is for.
    stubFetch({ 'http://127.0.0.1/x': { status: 200, body: 'local' } })
    const res = await sendRequest(spec({ url: 'http://127.0.0.1/x' }), {
      ...OPTS,
      allowPrivateNetwork: true,
    })
    expect(res.body).toBe('local')
  })
})

describe('credentials do not survive a hop to another origin', () => {
  const authed = spec({
    url: 'https://api.dev/start',
    auth: { type: 'bearer', token: 'ghp_SECRET' },
    headers: [{ name: 'Cookie', value: 'session=abc' }],
  })

  test('Authorization and Cookie are dropped crossing origins', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://other.dev/landing' },
      'https://other.dev/landing': { status: 200, body: 'ok' },
    })
    await sendRequest(authed, OPTS)
    expect(calls[0].headers.Authorization).toBe('Bearer ghp_SECRET')
    // The whole point: the second origin never sees them.
    expect(Object.keys(calls[1].headers).map((h) => h.toLowerCase())).not.toContain('authorization')
    expect(Object.keys(calls[1].headers).map((h) => h.toLowerCase())).not.toContain('cookie')
    expect(JSON.stringify(calls[1].headers)).not.toContain('ghp_SECRET')
  })

  test('they SURVIVE a same-origin redirect — that is not a leak', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://api.dev/moved' },
      'https://api.dev/moved': { status: 200, body: 'ok' },
    })
    await sendRequest(authed, OPTS)
    expect(calls[1].headers.Authorization).toBe('Bearer ghp_SECRET')
  })

  test('a different PORT is a different origin', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://api.dev:8443/moved' },
      'https://api.dev:8443/moved': { status: 200, body: 'ok' },
    })
    await sendRequest(authed, OPTS)
    expect(JSON.stringify(calls[1].headers)).not.toContain('ghp_SECRET')
  })

  test('a non-credential header is kept across origins', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://other.dev/x' },
      'https://other.dev/x': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ headers: [{ name: 'Accept', value: 'application/json' }] }), OPTS)
    expect(calls[1].headers.Accept).toBe('application/json')
  })
})

describe('the method across a redirect follows the browser rule', () => {
  const post = spec({
    method: 'POST',
    body: { mimeType: 'application/json', text: '{"a":1}' },
  })

  test.each([
    [303, 'GET'],
    [302, 'GET'],
    [301, 'GET'],
    [307, 'POST'],
    [308, 'POST'],
  ] as const)('a %i after a POST continues as %s', async (status, expected) => {
    const calls = stubFetch({
      'https://api.dev/start': { status, location: 'https://api.dev/next' },
      'https://api.dev/next': { status: 200, body: 'ok' },
    })
    await sendRequest(post, OPTS)
    expect(calls[1].method).toBe(expected)
  })

  test('a redirected GET drops the body with the method', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 303, location: 'https://api.dev/next' },
      'https://api.dev/next': { status: 200, body: 'ok' },
    })
    await sendRequest(post, OPTS)
    expect(calls[0].body).toBe('{"a":1}')
    expect(calls[1].body).toBeUndefined()
  })

  test('a redirected GET also drops the headers that described its old body', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 303, location: 'https://api.dev/next' },
      'https://api.dev/next': { status: 200, body: 'ok' },
    })
    await sendRequest(
      spec({
        method: 'POST',
        headers: [
          { name: 'Content-Type', value: 'application/custom+json' },
          { name: 'Content-Length', value: '7' },
          { name: 'X-Trace', value: 'keep-me' },
        ],
        body: { mimeType: 'application/json', text: '{"a":1}' },
      }),
      OPTS,
    )
    const names = Object.keys(calls[1].headers).map((name) => name.toLowerCase())
    expect(names).not.toContain('content-type')
    expect(names).not.toContain('content-length')
    expect(calls[1].headers['X-Trace']).toBe('keep-me')
  })

  test.each([301, 302] as const)('a %i keeps a PUT and its body', async (status) => {
    const calls = stubFetch({
      'https://api.dev/start': { status, location: 'https://api.dev/next' },
      'https://api.dev/next': { status: 200, body: 'ok' },
    })
    await sendRequest(
      spec({
        method: 'PUT',
        body: { mimeType: 'application/json', text: '{"a":1}' },
      }),
      OPTS,
    )
    expect(calls[1].method).toBe('PUT')
    expect(calls[1].body).toBe('{"a":1}')
  })

  test('a 307 keeps the body, because it keeps the method', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 307, location: 'https://api.dev/next' },
      'https://api.dev/next': { status: 200, body: 'ok' },
    })
    await sendRequest(post, OPTS)
    expect(calls[1].body).toBe('{"a":1}')
  })
})

describe('redirects are bounded and optional', () => {
  test('a redirect LOOP throws rather than spinning', async () => {
    stubFetch({
      'https://api.dev/a': { status: 302, location: 'https://api.dev/b' },
      'https://api.dev/b': { status: 302, location: 'https://api.dev/a' },
    })
    expect(await refusal(spec({ url: 'https://api.dev/a' }))).toMatch(/Too many redirects/)
  })

  test('followRedirects: false returns the 3xx itself', async () => {
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'https://api.dev/moved' },
    })
    const res = await sendRequest(spec({ followRedirects: false }), OPTS)
    expect(res.status).toBe(302)
    expect(calls).toHaveLength(1)
    expect(res.headers.location).toBe('https://api.dev/moved')
  })

  test('a 3xx with no Location is a response, not a redirect', async () => {
    stubFetch({ 'https://api.dev/start': { status: 304 } })
    const res = await sendRequest(spec(), OPTS)
    expect(res.status).toBe(304)
  })
})

describe('the reported url', () => {
  test('an apikey-in-query is masked in url AND every hop', async () => {
    const calls = stubFetch({
      'https://api.dev/start?api_key=sk_SECRET': {
        status: 302,
        location: 'https://api.dev/moved?api_key=sk_SECRET',
      },
      'https://api.dev/moved?api_key=sk_SECRET': { status: 200, body: 'ok' },
    })
    const res = await sendRequest(
      spec({ auth: { type: 'apikey', key: 'api_key', value: 'sk_SECRET', addTo: 'query' } }),
      OPTS,
    )
    // The wire really carries it…
    expect(calls[0].url).toContain('sk_SECRET')
    // …and nothing we report does.
    expect(res.url).not.toContain('sk_SECRET')
    expect(JSON.stringify(res.hops)).not.toContain('sk_SECRET')
    expect(res.hops).toHaveLength(2)
  })
})

describe('a server cannot reflect a sent credential into observable response data', () => {
  test('a bearer token echoed in the body is redacted inside sendRequest', async () => {
    stubFetch({
      'https://api.dev/start': {
        status: 200,
        body: '{"authorization":"Bearer top-secret-token"}',
      },
    })
    const response = await sendRequest(
      spec({ auth: { type: 'bearer', token: 'top-secret-token' } }),
      OPTS,
    )
    expect(response.body).not.toContain('top-secret-token')
    expect(response.body).toContain('REDACTED')
  })

  test('an environment secret echoed in the body is redacted too', async () => {
    stubFetch({
      'https://api.dev/start': { status: 200, body: 'environment-secret-value' },
    })
    const response = await sendRequest(spec(), {
      ...OPTS,
      secretValues: ['environment-secret-value'],
    })
    expect(response.body).toBe('REDACTED')
  })
})

describe('a bad url is explained before the network is touched', () => {
  test('a schemeless url names the scheme, not an LFI attempt', async () => {
    const calls = stubFetch({})
    const message = await refusal(spec({ url: 'localhost:3000/api' }))
    expect(message).toContain('no scheme')
    expect(calls).toEqual([])
  })

  test('the raw TypeError from `new URL` no longer reaches the user', async () => {
    stubFetch({})
    // `buildUrl` calls `new URL`, which throws 'cannot be parsed as a URL' — Bun's sentence, not
    // ours. urlProblem runs first precisely so that string never surfaces.
    const message = await refusal(spec({ url: 'api.github.com/user' }))
    expect(message).not.toContain('cannot be parsed as a URL')
    expect(message).toContain('https://api.github.com/user')
  })

  test('the explanation never repeats an inline credential from the invalid url', async () => {
    const calls = stubFetch({})
    const message = await refusal(spec({ url: 'api.dev/x?access_token=top-secret' }))
    expect(message).not.toContain('top-secret')
    expect(message).toContain('REDACTED')
    expect(calls).toEqual([])
  })

  test('the PER-HOP guard is untouched: a 302 → file:// is still refused', async () => {
    // THIS TEST IS THE ONLY THING HOLDING THE GUARD UP, and that is measured, not guessed.
    //
    // `urlProblem` runs before the fetch loop and refuses `file:///etc/passwd` as a direct url. It
    // therefore SHADOWS the older test above ('allowPrivateNetwork=%p still refuses file://'):
    // with `guard`'s scheme check deleted, that test — both its cases — still passes, because
    // urlProblem answered first. Verified by deleting the check: the suite went green except for
    // this one test.
    //
    // So the older test no longer proves what its name says, and without the case below the scheme
    // check inside `guard` could be removed entirely with 898 tests green, while `302 → file://`
    // quietly became exploitable. urlProblem sees the url we were GIVEN and cannot see a redirect
    // target; `guard` sees every hop. Neither substitutes for the other, and a new check landing in
    // front of an old one is exactly how a guard stops being tested without anyone noticing.
    const calls = stubFetch({
      'https://api.dev/start': { status: 302, location: 'file:///etc/passwd' },
    })
    const message = await refusal(spec({ url: 'https://api.dev/start' }))
    expect(message).toContain('http(s) only')
    // The first hop happened (it is a real server); the file:// hop did not.
    expect(calls.map((c) => c.url)).toEqual(['https://api.dev/start'])
  })

  test('a valid url is unaffected', async () => {
    const calls = stubFetch({ 'https://api.dev/start': { status: 200, body: 'ok' } })
    expect((await sendRequest(spec(), OPTS)).status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})

describe('an unfilled :path placeholder is refused before the network is touched', () => {
  // Placed in `sendRequest` rather than in the tool, and that is the entire design decision.
  // `missingVarsProblem` — the check for the url's OTHER placeholder syntax — is duplicated across
  // BOTH send paths (the tool and routes.ts) because each caller was trusted to remember. That is
  // exactly how `file://` shipped: the tool's path checked it, the route's did not, and a saved
  // `{{p}}` with `p = file:///Users/me/.ssh/id_rsa` returned that file to the browser. So this
  // check went where `guard` is, below both callers, where forgetting is not an option.
  test('it refuses, and no request is made', async () => {
    const calls = stubFetch({})
    const message = await refusal(spec({ url: 'https://api.dev/u/:id' }))
    expect(message).toContain('`:id`')
    expect(message).toContain('"pathParams"')
    expect(calls).toEqual([])
  })

  test('the placeholder explanation masks credentials carried by the url', async () => {
    stubFetch({})
    const message = await refusal(spec({ url: 'https://api.dev/u/:id?access_token=top-secret' }))
    expect(message).not.toContain('top-secret')
    expect(message).toContain('REDACTED')
  })

  test('a value supplied under the WRONG name is refused, not silently dropped', async () => {
    // The nastiest of the measured cases: a value WAS given, the name did not match, and the
    // placeholder went to the server as text.
    const calls = stubFetch({})
    expect(
      await refusal(
        spec({ url: 'https://api.dev/u/:id', pathParameters: [{ name: 'wrong', value: '42' }] }),
      ),
    ).toContain('`:id`')
    expect(calls).toEqual([])
  })

  test('a HALF-filled path is refused — it is worse than a 404, it can be a real route', async () => {
    const calls = stubFetch({})
    const message = await refusal(
      spec({
        url: 'https://api.dev/u/:id/posts/:postId',
        pathParameters: [{ name: 'id', value: '42' }],
      }),
    )
    expect(message).toContain('`:postId`')
    expect(message).not.toContain('`:id`')
    expect(calls).toEqual([])
  })

  test('a filled path sends, and arrives substituted and url-encoded', async () => {
    const calls = stubFetch({ 'https://api.dev/u/a%20b': { status: 200, body: 'ok' } })
    const res = await sendRequest(
      spec({ url: 'https://api.dev/u/:id', pathParameters: [{ name: 'id', value: 'a b' }] }),
      OPTS,
    )
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://api.dev/u/a%20b')
  })

  test('a url with a port is not mistaken for a placeholder', async () => {
    const calls = stubFetch({ 'https://api.dev:8443/x': { status: 200, body: 'ok' } })
    expect((await sendRequest(spec({ url: 'https://api.dev:8443/x' }), OPTS)).status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})

describe('a login redirect carries its cookie — the 200 that meant nothing', () => {
  // Measured before this existed:
  //   POST https://api.dev/login       Cookie: (none)  → 302, Set-Cookie: session=abc123
  //   GET  https://api.dev/dashboard   Cookie: (none)  → 200 "<html>Please log in</html>"
  // The caller got `200 OK` and every other line this mini app writes teaches that 2xx worked, so
  // an agent reports a successful login while standing on the login page. We follow the redirect
  // ourselves, so we are the thing that has to carry the cookie. Nothing did.
  const cookieOf = (c: Call) =>
    Object.entries(c.headers).find(([k]) => k.toLowerCase() === 'cookie')?.[1]

  test('Set-Cookie on a 302 reaches the next hop', async () => {
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://api.dev/dashboard',
        setCookie: ['session=abc123; Path=/; HttpOnly'],
      },
      'https://api.dev/dashboard': { status: 200, body: 'welcome' },
    })
    await sendRequest(spec({ method: 'POST', url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[0])).toBeUndefined()
    expect(cookieOf(calls[1])).toBe('session=abc123')
  })

  test('several cookies all carry — and each Set-Cookie is read separately', async () => {
    // A comma is legal inside `Expires=Wed, 21 Oct 2015 07:28:00 GMT`, so a folded
    // `headers.get('set-cookie')` cannot be split back apart. This pins that we do not try.
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://api.dev/dashboard',
        setCookie: ['session=abc; Expires=Wed, 21 Oct 2025 07:28:00 GMT', 'csrf=tok; Path=/'],
      },
      'https://api.dev/dashboard': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[1])).toBe('session=abc; csrf=tok')
  })

  test('a cookie accumulates across a chain, and a later value replaces an earlier one', async () => {
    const calls = stubFetch({
      'https://api.dev/a': { status: 302, location: 'https://api.dev/b', setCookie: ['s=first'] },
      'https://api.dev/b': {
        status: 302,
        location: 'https://api.dev/c',
        setCookie: ['s=second', 'x=1'],
      },
      'https://api.dev/c': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/a' }), OPTS)
    expect(cookieOf(calls[1])).toBe('s=first')
    expect(cookieOf(calls[2])).toBe('s=second; x=1')
  })

  test("the user's own Cookie header survives and wins", async () => {
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://api.dev/dash',
        setCookie: ['s=theirs', 'c=1'],
      },
      'https://api.dev/dash': { status: 200, body: 'ok' },
    })
    await sendRequest(
      spec({ url: 'https://api.dev/login', headers: [{ name: 'Cookie', value: 's=mine' }] }),
      OPTS,
    )
    expect(cookieOf(calls[1])).toBe('s=mine; c=1')
  })

  test('Max-Age=0 mid-chain drops the cookie', async () => {
    const calls = stubFetch({
      'https://api.dev/a': { status: 302, location: 'https://api.dev/b', setCookie: ['s=x'] },
      'https://api.dev/b': {
        status: 302,
        location: 'https://api.dev/c',
        setCookie: ['s=; Max-Age=0'],
      },
      'https://api.dev/c': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/a' }), OPTS)
    expect(cookieOf(calls[1])).toBe('s=x')
    expect(cookieOf(calls[2])).toBeUndefined()
  })
})

describe('THE JAR MUST NOT UNDO stripAuthAcrossOrigin', () => {
  // This is the group worth having. `stripAuthAcrossOrigin` drops the `Cookie` header on a
  // cross-origin hop; a jar that quietly re-added the session on the next hop would defeat that
  // guard from the inside — a helper handing a session to a host the guard just refused to give
  // it to. Worse than having no jar at all, and invisible: everything still returns 200.
  const cookieOf = (c: Call) =>
    Object.entries(c.headers).find(([k]) => k.toLowerCase() === 'cookie')?.[1]

  test('a cookie set by one origin NEVER reaches another', async () => {
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://evil.dev/collect',
        setCookie: ['session=abc123'],
      },
      'https://evil.dev/collect': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[1])).toBeUndefined()
    expect(JSON.stringify(calls[1].headers)).not.toContain('abc123')
  })

  test('a different PORT is a different origin', async () => {
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://api.dev:8443/x',
        setCookie: ['s=abc'],
      },
      'https://api.dev:8443/x': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[1])).toBeUndefined()
  })

  test('a different SCHEME is a different origin — no https cookie over http', async () => {
    const calls = stubFetch({
      'https://api.dev/login': { status: 302, location: 'http://api.dev/x', setCookie: ['s=abc'] },
      'http://api.dev/x': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[1])).toBeUndefined()
  })

  test('and the jar is CLEARED — it does not come back when the chain returns to the origin', async () => {
    // The subtle one: api.dev → evil.dev → api.dev must not resurrect the session, or a redirect
    // through anywhere becomes a way to launder it back.
    const calls = stubFetch({
      'https://api.dev/login': {
        status: 302,
        location: 'https://evil.dev/bounce',
        setCookie: ['s=abc'],
      },
      'https://evil.dev/bounce': { status: 302, location: 'https://api.dev/back' },
      'https://api.dev/back': { status: 200, body: 'ok' },
    })
    await sendRequest(spec({ url: 'https://api.dev/login' }), OPTS)
    expect(cookieOf(calls[2])).toBeUndefined()
  })
})

describe('timeoutMs is honoured — it was declared, documented, passed in, and read by nothing', () => {
  // `SendOptions.timeoutMs` existed, the README called it "Per-request timeout", and both callers
  // passed it. Nothing in send.ts read it. The TOOL path happened to survive because it separately
  // wrapped the call in `ctx.helpers.withTimeoutSignal`; the ROUTE path passed it in good faith and
  // got nothing, so a workbench send hung as long as the server did. Measured: `timeoutMs: 200`
  // returned after 3011ms. The third guarantee this mini app split across two send paths and lost
  // one of — after `guard` and `unfilledPathParams`.

  /**
   * A fetch that HONOURS the signal, the way a real one does.
   *
   * This matters more than it looks: the first repro used a stub that ignored `signal`, so it
   * showed the fix "not working" when the fix was fine and the stub could not abort. A stub that
   * cannot be cancelled cannot demonstrate a timeout either way.
   */
  function stubSlowFetch(delayMs: number) {
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response('late')), delayMs)
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch
  }

  test('a slow request is aborted, and says so', async () => {
    stubSlowFetch(3_000)
    const started = Date.now()
    const err = await sendRequest(spec(), { ...OPTS, timeoutMs: 100 }).catch((e) => e)
    expect(err).toBeInstanceOf(RequestTimeoutError)
    expect(err.message).toContain('timed out after 100ms')
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test('a USER abort is NOT reported as a timeout — one is retryable, the other is not', async () => {
    stubSlowFetch(3_000)
    const ac = new AbortController()
    const pending = sendRequest(spec(), { ...OPTS, timeoutMs: 30_000, signal: ac.signal }).catch(
      (e) => e,
    )
    await new Promise((r) => setTimeout(r, 0)) // the request is in flight
    ac.abort()
    const err = await pending
    expect(err).not.toBeInstanceOf(RequestTimeoutError)
  })

  test('a fast request is untouched', async () => {
    stubFetch({ 'https://api.dev/start': { status: 200, body: 'ok' } })
    expect((await sendRequest(spec(), { ...OPTS, timeoutMs: 5_000 })).status).toBe(200)
  })

  test('the budget covers the WHOLE chain, not each hop', async () => {
    // A per-hop timer would let ten redirects take ten times the limit. "Per-request" means the
    // request. Each hop here is comfortably under the limit; together they are not.
    let hop = 0
    globalThis.fetch = ((_i: unknown, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        const n = hop++
        const t = setTimeout(
          () =>
            resolve(
              n < 4
                ? new Response(null, {
                    status: 302,
                    headers: { location: `https://api.dev/${n + 1}` },
                  })
                : new Response('arrived'),
            ),
          60,
        )
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as typeof fetch
    const err = await sendRequest(spec(), { ...OPTS, timeoutMs: 150 }).catch((e) => e)
    expect(err).toBeInstanceOf(RequestTimeoutError)
  })
})

describe('a response is decoded as the SERVER encoded it, not as we hope', () => {
  // `readBodyCapped` built a bare `new TextDecoder()` — UTF-8, always — and the response's own
  // charset was never read. Measured before the fix, with real bytes:
  //   charset=windows-1251  a Cyrillic greeting → one replacement character per byte
  //   charset=ISO-8859-1    "café résumé" → "caf� r�sum�"
  //   charset=Shift_JIS     "こんにちは"    → "����ɂ���"
  // An agent then reasons about the mojibake and reports the API as broken.
  // Built from code points rather than written out: the product's own text is English, and a
  // literal here would be the only non-Latin string in the tree. These are the bytes of a
  // Cyrillic greeting, which is what windows-1251 exists to carry.
  const GREETING = String.fromCodePoint(
    0x41f,
    0x440,
    0x438,
    0x432,
    0x435,
    0x442,
    0x2c,
    0x20,
    0x43c,
    0x438,
    0x440,
  )

  function stubBytes(bytes: number[], contentType: string) {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(new Uint8Array(bytes), {
          headers: { 'content-type': contentType },
        }),
      { preconnect: () => {} },
    )
  }

  test('ISO-8859-1 comes back as text, not replacement characters', async () => {
    // "café" in latin-1.
    stubBytes([0x63, 0x61, 0x66, 0xe9], 'text/plain; charset=ISO-8859-1')
    const res = await sendRequest(spec(), OPTS)
    expect(res.body).toBe('café')
    expect(res.charsetProblem).toBeUndefined()
  })

  test('Shift_JIS too', async () => {
    stubBytes(
      [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd],
      'text/plain; charset=Shift_JIS',
    )
    expect((await sendRequest(spec(), OPTS)).body).toBe('こんにちは')
  })

  test('utf-8 is unaffected — the default path must not regress', async () => {
    stubBytes([...new TextEncoder().encode(GREETING)], 'text/plain; charset=utf-8')
    expect((await sendRequest(spec(), OPTS)).body).toBe(GREETING)
  })

  test('a response with NO charset is read as utf-8, silently', async () => {
    stubBytes([...new TextEncoder().encode('{"a":1}')], 'application/json')
    const res = await sendRequest(spec(), OPTS)
    expect(res.body).toBe('{"a":1}')
    expect(res.charsetProblem).toBeUndefined()
  })

  test('windows-1251 comes back as the Cyrillic it carries', async () => {
    // Bun 1.3 had no windows-1251 decoder, and this body came back garbled with a warning.
    stubBytes([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2], 'text/plain; charset=windows-1251')
    const res = await sendRequest(spec(), OPTS)
    expect(res.body).toBe(GREETING.slice(0, 6))
    expect(res.charsetProblem).toBeUndefined()
  })

  test('a charset beyond the runtime is garbled and SAYS SO', async () => {
    // The honest half. Bun's TextDecoder has no utf-7, so this cannot be decoded. What it must
    // never do is hand back nonsense with nothing to indicate it.
    stubBytes([...new TextEncoder().encode('+BB8EQAQ4BDIENQRC-')], 'text/plain; charset=utf-7')
    const res = await sendRequest(spec(), OPTS)
    expect(res.body).not.toBe(GREETING.slice(0, 6))
    expect(res.charsetProblem).toContain('utf-7')
    expect(res.charsetProblem).toContain("not the server's fault")
  })

  test('an unsupported charset does not THROW — a garbled body beats a failed send', async () => {
    // `new TextDecoder('utf-7')` raises RangeError. Passing a charset through unchecked would
    // turn a mojibake response into a failed request, which is strictly worse.
    stubBytes([0x61], 'text/plain; charset=iso-2022-kr')
    expect((await sendRequest(spec(), OPTS)).status).toBe(200)
  })
})
