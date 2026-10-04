/**
 * The grammar's two promises: tolerant parsing with canonical formatting, and a url build that
 * loses neither the query the user wrote into the url nor the pairs they passed beside it.
 */

import { describe, expect, test } from 'bun:test'
import {
  activePairs,
  applyPathParams,
  bodyIsForm,
  buildUrl,
  HTTP_METHODS,
  isHttpUrl,
  methodAllowsBody,
  parseMethod,
  PATH_PARAM_RE,
  unfilledPathParams,
  unfilledPathParamsProblem,
  urlProblem,
} from './request-spec'

describe('parseMethod', () => {
  test.each(['get', 'GET', ' Get '])('%p normalises to GET', (raw) => {
    expect(parseMethod(raw)).toBe('GET')
  })

  test('every canonical method round-trips', () => {
    for (const m of HTTP_METHODS) expect(parseMethod(m)).toBe(m)
  })

  test.each([undefined, '', 'TRACE', 'CONNECT'])('%p is not a method we speak', (raw) => {
    expect(parseMethod(raw)).toBeNull()
  })
})

describe('methodAllowsBody', () => {
  test('GET/HEAD/OPTIONS carry none', () => {
    expect(methodAllowsBody('GET')).toBe(false)
    expect(methodAllowsBody('HEAD')).toBe(false)
    expect(methodAllowsBody('OPTIONS')).toBe(false)
  })

  test('POST/PUT/PATCH/DELETE do', () => {
    expect(methodAllowsBody('POST')).toBe(true)
    expect(methodAllowsBody('PUT')).toBe(true)
    expect(methodAllowsBody('PATCH')).toBe(true)
    expect(methodAllowsBody('DELETE')).toBe(true)
  })
})

describe('buildUrl', () => {
  test('appends pairs to a query already written into the url', () => {
    const url = buildUrl({
      url: 'https://api.dev/search?q=cats',
      query: [{ name: 'page', value: '2' }],
    })
    expect(url.searchParams.get('q')).toBe('cats')
    expect(url.searchParams.get('page')).toBe('2')
  })

  test('skips disabled pairs', () => {
    const url = buildUrl({
      url: 'https://api.dev/search',
      query: [
        { name: 'page', value: '2' },
        { name: 'debug', value: '1', disabled: true },
      ],
    })
    expect(url.searchParams.has('debug')).toBe(false)
  })

  test('url-encodes values rather than pasting them raw', () => {
    const url = buildUrl({ url: 'https://api.dev/s', query: [{ name: 'q', value: 'a b&c' }] })
    expect(url.toString()).toContain('q=a+b%26c')
  })

  test('repeats a name rather than collapsing it — ?tag=a&tag=b is a real API shape', () => {
    const url = buildUrl({
      url: 'https://api.dev/s',
      query: [
        { name: 'tag', value: 'a' },
        { name: 'tag', value: 'b' },
      ],
    })
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b'])
  })
})

describe('activePairs', () => {
  test('drops disabled and blank-named pairs', () => {
    expect(
      activePairs([
        { name: 'a', value: '1' },
        { name: 'b', value: '2', disabled: true },
        { name: '  ', value: '3' },
      ]),
    ).toEqual([{ name: 'a', value: '1' }])
  })

  test('undefined is empty, not a throw', () => {
    expect(activePairs(undefined)).toEqual([])
  })
})

describe('bodyIsForm', () => {
  test('recognises form mime types, charset and all', () => {
    expect(bodyIsForm({ mimeType: 'application/x-www-form-urlencoded' })).toBe(true)
    expect(bodyIsForm({ mimeType: 'application/x-www-form-urlencoded; charset=utf-8' })).toBe(true)
    expect(bodyIsForm({ mimeType: 'multipart/form-data' })).toBe(true)
  })

  test('anything else reads `text`', () => {
    expect(bodyIsForm({ mimeType: 'application/json' })).toBe(false)
    expect(bodyIsForm(undefined)).toBe(false)
  })
})

describe('isHttpUrl', () => {
  test.each(['https://api.dev', 'http://api.dev/x?y=1'])('%p is sendable', (u) => {
    expect(isHttpUrl(u)).toBe(true)
  })

  test.each(['file:///etc/passwd', 'ftp://x.dev', 'api.dev', 'not a url'])(
    '%p is not ours to send',
    (u) => {
      expect(isHttpUrl(u)).toBe(false)
    },
  )
})

describe('path parameters', () => {
  test('a placeholder is substituted and url-encoded', () => {
    expect(applyPathParams('https://api.dev/users/:id', [{ name: 'id', value: 'a b' }])).toBe(
      'https://api.dev/users/a%20b',
    )
  })

  test('several placeholders each fill', () => {
    expect(
      applyPathParams('https://api.dev/o/:org/r/:repo', [
        { name: 'org', value: 'acme' },
        { name: 'repo', value: 'widgets' },
      ]),
    ).toBe('https://api.dev/o/acme/r/widgets')
  })

  test('a repeated placeholder fills every occurrence', () => {
    expect(applyPathParams('https://api.dev/:v/x/:v', [{ name: 'v', value: '1' }])).toBe(
      'https://api.dev/1/x/1',
    )
  })

  test('an UNFILLED placeholder stays visible rather than collapsing the segment', () => {
    // `/users/` is a real, different endpoint that would answer plausibly and wrongly.
    expect(applyPathParams('https://api.dev/users/:id', [])).toBe('https://api.dev/users/:id')
    expect(applyPathParams('https://api.dev/users/:id', [{ name: 'id', value: '' }])).toBe(
      'https://api.dev/users/:id',
    )
  })

  test('a disabled pair does not fill', () => {
    expect(
      applyPathParams('https://api.dev/users/:id', [{ name: 'id', value: '1', disabled: true }]),
    ).toBe('https://api.dev/users/:id')
  })

  test('a port is NOT a path parameter', () => {
    expect(applyPathParams('https://api.dev:8443/users', [{ name: '8443', value: 'x' }])).toBe(
      'https://api.dev:8443/users',
    )
  })

  test('a colon inside a segment is left alone', () => {
    expect(applyPathParams('https://api.dev/urn:foo/x', [{ name: 'foo', value: 'y' }])).toBe(
      'https://api.dev/urn:foo/x',
    )
  })

  test('a value cannot inject extra path segments — it is encoded', () => {
    expect(applyPathParams('https://api.dev/users/:id', [{ name: 'id', value: '../admin' }])).toBe(
      'https://api.dev/users/..%2Fadmin',
    )
  })
})

describe('buildUrl fills path parameters', () => {
  test('the built url is the substituted one — the same string the guard checks', () => {
    const url = buildUrl({
      url: 'https://api.dev/users/:id',
      query: [{ name: 'full', value: 'true' }],
      pathParameters: [{ name: 'id', value: '42' }],
    })
    expect(url.toString()).toBe('https://api.dev/users/42?full=true')
  })
})

describe('urlProblem explains a url instead of leaking a TypeError', () => {
  // Both of the commonest wrong urls used to answer uselessly or accusingly:
  //   localhost:3000/api  → 'Refusing to send to "localhost://…" … can read local files'
  //   api.github.com/user → '"api.github.com/user" cannot be parsed as a URL.'  (Bun's TypeError)
  // The first accuses someone of an LFI attempt for typing the most ordinary url in local dev; the
  // second is not even our sentence.

  test.each([
    'https://api.dev/x',
    'http://api.dev/x',
    'https://api.dev/u/:id',
    'https://user:pw@api.dev/x',
    'http://localhost:3000/api',
    'https://127.0.0.1:8080/x',
  ])('%p is fine', (url) => {
    expect(urlProblem(url)).toBeNull()
  })

  describe('a schemeless host is named as such, with the fix', () => {
    test.each([
      ['api.github.com/user', 'a bare host'],
      [
        'localhost:3000/api',
        'URL() reads this as scheme `localhost:` and puts the PORT in the path',
      ],
      ['example.com:8080/x', 'same trap, a real domain'],
      ['127.0.0.1:8080/x', 'an ip and port'],
      ['api.dev', 'a host with no path'],
      ['api.dev?q=1', 'a host with only a query'],
    ])('%p (%s)', (url) => {
      const problem = urlProblem(url)
      expect(problem?.message).toContain('no scheme')
      expect(problem?.message).toContain(`https://${url}`)
      // A typo is the USER's — a 400, never a 502 blamed on the server.
      expect(problem?.code).toBe('bad_request')
    })

    test('and it says WHY the scheme is not guessed — the credential, not pedantry', () => {
      // The reference defaults this to `http://`. We resolve ${secret:KEY} at send time, so
      // guessing plaintext on someone's behalf would put a bearer token on the wire in the clear.
      expect(urlProblem('api.dev/x')?.message).toContain('plaintext')
    })
  })

  describe('a REAL non-http scheme is still refused as one — not excused as a typo', () => {
    test.each(['file:///etc/passwd', 'file:/etc/passwd', 'data:text/html,x', 'ftp://h/f'])(
      '%p',
      (url) => {
        const problem = urlProblem(url)
        expect(problem?.message).toContain('http(s) only')
        expect(problem?.message).not.toContain('no scheme')
        // `blocked`, not `bad_request`: the url is well-formed and we are REFUSING it. The route
        // turns that into a 403 and the UI must not offer a retry — we would refuse it again.
        expect(problem?.code).toBe('blocked')
      },
    )
  })

  test.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
  ])('%p is reported as empty (%s)', (url) => {
    expect(urlProblem(url)?.message).toContain('empty')
  })

  test.each([
    ['{{base}}/users', 'an unresolved variable'],
    ['not a url', 'prose'],
    ['://x', 'a scheme with no name'],
  ])('%p is reported as unparseable (%s)', (url) => {
    expect(urlProblem(url)?.message).toContain('needs to look like')
    expect(urlProblem(url)?.code).toBe('bad_request')
  })
})

describe('unfilledPathParams — the url placeholder that was never checked', () => {
  // `{{base_url}}` unresolved is refused with a sentence naming the variable. An unfilled `:id`
  // was sent as four literal characters. Nobody decided that asymmetry; `:id` just never got the
  // check `{{id}}` got. All four rows below were measured against `buildUrl` before the fix.
  const p = (name: string, value: string, disabled?: boolean) => ({
    name,
    value,
    ...(disabled ? { disabled } : {}),
  })

  test.each([
    ['https://api.dev/u/:id', undefined, ['id'], 'no params at all'],
    ['https://api.dev/u/:id', [], ['id'], 'an empty list'],
    [
      'https://api.dev/u/:id',
      [p('id', '')],
      ['id'],
      'an EMPTY value — applyPathParams leaves it unsubstituted too',
    ],
    [
      'https://api.dev/u/:id',
      [p('wrong', '42')],
      ['id'],
      'a MISMATCHED name: the value was supplied and silently dropped',
    ],
    [
      'https://api.dev/u/:id/posts/:postId',
      [p('id', '42')],
      ['postId'],
      'half-filled — a real route on some servers',
    ],
    ['https://api.dev/u/:id', [p('id', '42', true)], ['id'], 'a DISABLED param is not a value'],
  ])('%s + %j → unfilled %j (%s)', (url, params, expected) => {
    expect(unfilledPathParams(url, params as never)).toEqual(expected as string[])
  })

  test.each([
    ['https://api.dev/u/:id', [p('id', '42')], 'filled'],
    ['https://api.dev/users', undefined, 'no placeholders'],
    ['https://api.dev/u/:id', [p('id', '0')], "'0' is a value — truthiness must not eat it"],
  ])('%s + %j → nothing unfilled (%s)', (url, params) => {
    expect(unfilledPathParams(url, params as never)).toEqual([])
  })

  describe('it agrees with applyPathParams, because it reads the SAME regex', () => {
    // Two regexes saying the same thing is the pairValue lesson waiting to happen: the same
    // knowledge in two copies, and the report drifts from the substitution.
    test.each([
      ['https://host:8443/x', 'a PORT is not a path parameter'],
      ['https://api.dev/urn:foo', 'a colon inside a segment is not one either'],
      ['https://api.dev/u/:id?next=:x', 'a colon in the query string is not one'],
    ])('%s → nothing claimed (%s)', (url) => {
      // Whatever applyPathParams would not substitute, this must not report.
      const reported = unfilledPathParams(url, [])
      const substituted = (url.match(PATH_PARAM_RE) ?? []).map((m) => m.slice(2))
      expect(reported).toEqual([...new Set(substituted)])
    })
  })

  test('a repeated placeholder is reported once', () => {
    expect(unfilledPathParams('https://api.dev/:v/x/:v', [])).toEqual(['v'])
  })
})

describe('unfilledPathParamsProblem', () => {
  test('it names the placeholder, the url, and the call that fills it', () => {
    const problem = unfilledPathParamsProblem(['id'], 'https://api.dev/u/:id')
    expect(problem).toContain('`:id`')
    expect(problem).toContain('https://api.dev/u/:id')
    expect(problem).toContain('"pathParams"')
    expect(problem).toContain('{"name":"id","value":"…"}')
  })

  test('it warns that a MISMATCHED name is ignored — the failure that supplies a value and drops it', () => {
    expect(unfilledPathParamsProblem(['id'], 'https://api.dev/u/:id')).toContain('match')
  })

  test('it reads correctly for several', () => {
    const problem = unfilledPathParamsProblem(['id', 'postId'], 'https://api.dev/u/:id/p/:postId')
    expect(problem).toContain('placeholders')
    expect(problem).toContain('`:postId`')
  })
})
