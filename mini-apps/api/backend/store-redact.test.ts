/**
 * `redactSpec` — every path that leaves the process reads through it.
 *
 * The header claims were auth-only for fourteen iterations, and so was the code, while the HAR and
 * cURL importers deliberately put credentials in HEADERS. These pin the composition.
 */

import { describe, expect, test } from 'bun:test'
import { REDACTED, redactHeaders, redactQuery, redactSpec } from './store'
import type { RequestSpec } from './request-spec'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/x',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

describe('a credential HEADER is masked on every outbound path', () => {
  test.each(['Authorization', 'Cookie', 'Proxy-Authorization'])('%s is masked', (name) => {
    const out = redactSpec(spec({ headers: [{ name, value: 'ghp_SUPERSECRET' }] }))
    expect(JSON.stringify(out)).not.toContain('ghp_SUPERSECRET')
  })

  test('the header NAME survives — you must still see that auth is there', () => {
    const out = redactSpec(spec({ headers: [{ name: 'Authorization', value: 'ghp_x' }] }))
    expect(out.headers[0].name).toBe('Authorization')
    expect(out.headers[0].value).not.toBe('ghp_x')
  })

  test('a ${secret:} reference reads through — a pointer is not a secret', () => {
    const out = redactSpec(
      spec({ headers: [{ name: 'Authorization', value: 'Bearer ${secret:GH}' }] }),
    )
    expect(out.headers[0].value).toContain('${secret:GH}')
  })

  test('an ordinary header is untouched', () => {
    const out = redactSpec(spec({ headers: [{ name: 'Accept', value: 'application/json' }] }))
    expect(out.headers[0].value).toBe('application/json')
  })

  test('auth AND headers are both covered at once', () => {
    const out = redactSpec(
      spec({
        auth: { type: 'bearer', token: 'AUTH_SECRET' },
        headers: [{ name: 'Cookie', value: 'HEADER_SECRET' }],
      }),
    )
    const json = JSON.stringify(out)
    expect(json).not.toContain('AUTH_SECRET')
    expect(json).not.toContain('HEADER_SECRET')
  })

  test('the input is not mutated', () => {
    const headers = [{ name: 'Authorization', value: 'ghp_x' }]
    redactHeaders(headers)
    expect(headers[0].value).toBe('ghp_x')
  })
})

/**
 * The list used to stop at the three names an HTTP spec defines, on the argument that anything else is
 * a guess. An API-KEY header is not a guess: the name states what the value is. Each case below is a
 * documented convention (AWS API Gateway, Azure / OpenAI-compatible, Google, AWS STS, GitLab).
 */
describe('an API-key header is a credential by name', () => {
  const cases = [
    ['X-Api-Key', 'AWS API Gateway'],
    ['api-key', 'Azure / OpenAI-compatible'],
    ['ApiKey', 'the no-dash spelling'],
    ['X-Auth-Token', 'a token by name'],
    ['X-Access-Token', 'a token by name'],
    ['X-Refresh-Token', 'a token by name'],
    ['X-Amz-Security-Token', 'an STS session token'],
    ['X-Goog-Api-Key', 'Google'],
    ['Private-Token', 'GitLab'],
    ['X-CSRF-Token', 'session-bound and replayable'],
    ['X-XSRF-Token', 'session-bound and replayable'],
  ] as const

  for (const [name, why] of cases) {
    test(`${name} is masked (${why})`, () => {
      const out = redactHeaders([{ name, value: 'live-secret-value' }])
      expect(out[0]?.value).not.toContain('live-secret-value')
      // The NAME survives, as with Authorization — you must still see that auth is there.
      expect(out[0]?.name).toBe(name)
    })
  }

  test('a name that WOULD be a guess is still untouched — this is not a scanner', () => {
    // The deliberate line: whether `X-Trace` or `X-Request-Id` holds a secret cannot be known, and a
    // guess that says yes blocks real work while one that says no lends false confidence.
    const out = redactHeaders([
      { name: 'X-Trace', value: 'abc123' },
      { name: 'X-Request-Id', value: 'req-1' },
      { name: 'Content-Type', value: 'application/json' },
    ])
    expect(out.map((h) => h.value)).toEqual(['abc123', 'req-1', 'application/json'])
  })

  test('a ${secret:} reference in an API-key header still reads through', () => {
    const out = redactHeaders([{ name: 'X-Api-Key', value: '${secret:STRIPE_KEY}' }])
    expect(out[0]?.value).toBe('${secret:STRIPE_KEY}')
  })
})

/**
 * The third place a credential lives, and the one `redactSpec` used to ignore: the query string.
 * `?api_key=sk-live-…` typed into the url (or carried in by a cURL/HAR import) reached every
 * model-facing surface verbatim, because `reportUrl` masked only the parameter NAMED BY THE AUTH BLOCK.
 */
describe('a credential in the query string is masked, in the url and in the pairs', () => {
  test('an inline url parameter is masked and the rest of the url survives', () => {
    const out = redactSpec(
      spec({ url: 'https://api.dev/v1/things?api_key=sk-live-abc&page=2&token=t-abc' }),
    )
    expect(out.url).not.toContain('sk-live-abc')
    expect(out.url).not.toContain('t-abc')
    // Redaction, not deletion: the endpoint and the non-credential parameters are intact.
    expect(out.url).toContain('https://api.dev/v1/things')
    expect(out.url).toContain('page=2')
    expect(out.url).toContain('api_key=')
  })

  test('a query PAIR is masked, and its name survives', () => {
    const out = redactSpec(
      spec({
        query: [
          { name: 'access_token', value: 'at-live-1' },
          { name: 'per_page', value: '50' },
        ],
      }),
    )
    expect(out.query[0]?.value).not.toContain('at-live-1')
    expect(out.query[0]?.name).toBe('access_token')
    expect(out.query[1]?.value).toBe('50')
  })

  test('an AMBIGUOUS parameter name is untouched — this is not a scanner', () => {
    // `key` is deliberately absent from the list even though Google uses `?key=<API_KEY>`: a bare
    // `key` is an ordinary parameter name, and the line is drawn at ambiguity.
    const out = redactSpec(
      spec({
        url: 'https://api.dev/x?key=abc&sig=xyz&sort=name',
        query: [{ name: 'key', value: 'abc' }],
      }),
    )
    expect(out.url).toContain('key=abc')
    expect(out.url).toContain('sig=xyz')
    expect(out.query[0]?.value).toBe('abc')
  })

  test('a ${secret:} reference reads through in both places', () => {
    const out = redactSpec(
      spec({
        url: 'https://api.dev/x?api_key=${secret:STRIPE}',
        query: [{ name: 'token', value: '${secret:GH}' }],
      }),
    )
    expect(out.url).toContain('${secret:STRIPE}')
    expect(out.query[0]?.value).toBe('${secret:GH}')
  })

  test('a url with no query string is returned unchanged', () => {
    expect(redactSpec(spec({ url: 'https://api.dev/x/:id' })).url).toBe('https://api.dev/x/:id')
  })
})

describe('credential pair identity and duplicate names', () => {
  test.each([
    ['headers', redactHeaders, 'Authorization'],
    ['query', redactQuery, 'token'],
  ] as const)('%s clones only masked rows and preserves source pairs', (_kind, redact, name) => {
    const literal = { name, value: 'literal', disabled: true }
    const reference = { name, value: '${secret:KEY}' }
    const ordinary = { name: 'trace', value: 'visible' }
    const input = [literal, reference, ordinary]
    const out = redact(input)
    expect(out).not.toBe(input)
    expect(out[0]).toEqual({ ...literal, value: REDACTED })
    expect(out[0]).not.toBe(literal)
    expect(out[1]).toBe(reference)
    expect(out[2]).toBe(ordinary)
    expect(literal.value).toBe('literal')
  })

  test.each([
    ['headers', redactHeaders, 'Authorization'],
    ['query', redactQuery, 'token'],
  ] as const)(
    '%s retains exact-spelling duplicate selection for blank values',
    (_kind, redact, name) => {
      const blank = { name, value: '  ' }
      expect(redact([blank])[0]).toBe(blank)
      const out = redact([
        blank,
        { name, value: 'literal' },
        { name: name.toUpperCase(), value: '  ' },
      ])
      expect(out[0]!.value).toBe(REDACTED)
      expect(out[1]!.value).toBe(REDACTED)
      expect(out[2]!.value).toBe('  ')
      expect(blank.value).toBe('  ')
    },
  )
})
