/**
 * Rendering a whole spec. The claim that matters most is the last one: auth is NOT rendered, so a
 * plaintext variable can never become a second way to carry a credential.
 */

import { describe, expect, test } from 'bun:test'
import { renderSpec } from './render-spec'
import { buildUrl, type RequestSpec } from './request-spec'

const vars = (o: Record<string, string>) => new Map(Object.entries(o))

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: '{{base_url}}/users',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const ENV = vars({ base_url: 'https://staging.api.dev', version: 'v2', account: 'acct_1' })

describe('what gets rendered', () => {
  test('the url', () => {
    expect(renderSpec(spec(), ENV).spec.url).toBe('https://staging.api.dev/users')
  })

  test('query names and values', () => {
    const out = renderSpec(spec({ query: [{ name: '{{version}}', value: '{{account}}' }] }), ENV)
    expect(out.spec.query).toEqual([{ name: 'v2', value: 'acct_1' }])
  })

  test('headers', () => {
    const out = renderSpec(spec({ headers: [{ name: 'X-Account', value: '{{account}}' }] }), ENV)
    expect(out.spec.headers).toEqual([{ name: 'X-Account', value: 'acct_1' }])
  })

  test('path parameters', () => {
    const out = renderSpec(
      spec({ url: '{{base_url}}/u/:id', pathParameters: [{ name: 'id', value: '{{account}}' }] }),
      ENV,
    )
    expect(out.spec.pathParameters).toEqual([{ name: 'id', value: 'acct_1' }])
  })

  test('a text body', () => {
    const out = renderSpec(
      spec({ body: { mimeType: 'application/json', text: '{"account":"{{account}}"}' } }),
      ENV,
    )
    expect(out.spec.body?.text).toBe('{"account":"acct_1"}')
  })

  test('a form body', () => {
    const out = renderSpec(
      spec({
        body: {
          mimeType: 'application/x-www-form-urlencoded',
          form: [{ name: 'a', value: '{{account}}' }],
        },
      }),
      ENV,
    )
    expect(out.spec.body?.form).toEqual([{ name: 'a', value: 'acct_1' }])
  })

  test('a disabled pair keeps its flag through the render', () => {
    const out = renderSpec(
      spec({ query: [{ name: 'x', value: '{{version}}', disabled: true }] }),
      ENV,
    )
    expect(out.spec.query).toEqual([{ name: 'x', value: 'v2', disabled: true }])
  })
})

describe('auth is NOT rendered', () => {
  test('a {{variable}} in a bearer token is left alone', () => {
    // Rendering auth would make a plaintext environment a second way to carry a credential, right
    // beside the encrypted one and indistinguishable at a glance.
    const out = renderSpec(spec({ auth: { type: 'bearer', token: '{{account}}' } }), ENV)
    expect(out.spec.auth).toEqual({ type: 'bearer', token: '{{account}}' })
  })

  test('a ${secret:} reference passes through untouched', () => {
    const auth = { type: 'bearer', token: '${secret:GH_TOKEN}' } as const
    expect(renderSpec(spec({ auth }), ENV).spec.auth).toEqual(auth)
  })
})

describe('the saved spec is never mutated', () => {
  test('rendering returns a copy — the request re-renders next time', () => {
    // A spec rendered in place would silently pin itself to the first environment it ever saw.
    const original = spec()
    renderSpec(original, ENV)
    expect(original.url).toBe('{{base_url}}/users')
  })
})

describe('missing variables', () => {
  test('are collected from every part of the request', () => {
    const out = renderSpec(
      spec({
        url: '{{base_url}}/x',
        headers: [{ name: 'H', value: '{{h_var}}' }],
        query: [{ name: '{{q_var}}', value: 'v' }],
        body: { mimeType: 'application/json', text: '{{b_var}}' },
      }),
      vars({}),
    )
    expect(out.missing.sort()).toEqual(['b_var', 'base_url', 'h_var', 'q_var'])
  })

  test('none when every variable resolves', () => {
    expect(renderSpec(spec(), ENV).missing).toEqual([])
  })

  test('none when the request uses no variables at all', () => {
    expect(renderSpec(spec({ url: 'https://api.dev/x' }), vars({})).missing).toEqual([])
  })

  test('an auth variable is NOT reported missing — auth is not rendered', () => {
    const out = renderSpec(
      spec({ url: 'https://api.dev/x', auth: { type: 'bearer', token: '{{nope}}' } }),
      vars({}),
    )
    expect(out.missing).toEqual([])
  })
})

describe('a render that breaks a JSON body is REFUSED, not sent', () => {
  // Verified before fixing: `{"name":"{{who}}"}` with who = 'Ada "the boss"' rendered to
  // `{"name":"Ada "the boss""}` — malformed JSON, sent, and whatever 400 came back read as the
  // API's fault. A newline did the same, and `a\b` was worse: it PARSED, because `\b` is a JSON
  // backspace escape, so the value silently became something else. Substitution is textual; JSON
  // is not. This hazard is easy to miss, so the check says so.
  const jsonBody = (text = '{"name":"{{who}}"}') =>
    spec({ body: { mimeType: 'application/json', text } })

  test.each([
    ['a quote', 'Ada "the boss" Lovelace'],
    ['a newline', 'line1\nline2'],
  ])('%s in a value is reported', (_label, value) => {
    const out = renderSpec(jsonBody(), vars({ who: value }))
    expect(out.problems).toHaveLength(1)
    expect(out.problems[0]).toContain('invalid JSON')
  })

  test('an ordinary value renders clean and silent', () => {
    const out = renderSpec(jsonBody(), vars({ who: 'Ada' }))
    expect(out.problems).toEqual([])
    expect(JSON.parse(out.spec.body!.text!)).toEqual({ name: 'Ada' })
  })

  test('a JSON FRAGMENT in one variable still works — this is why we do not escape', () => {
    // Escaping every value would turn this into the string `"{\"a\":1}"`. Whether a variable is a
    // string inside JSON or a fragment OF JSON is genuinely ambiguous, so we detect instead.
    const out = renderSpec(
      spec({ body: { mimeType: 'application/json', text: '{{payload}}' } }),
      vars({ payload: '{"a":1}' }),
    )
    expect(out.problems).toEqual([])
    expect(JSON.parse(out.spec.body!.text!)).toEqual({ a: 1 })
  })

  test('a body the USER typed as invalid JSON is not our complaint', () => {
    // No template, so we substituted nothing — maybe the server is lenient. Not ours to block.
    const out = renderSpec(
      spec({ body: { mimeType: 'application/json', text: '{not json}' } }),
      vars({}),
    )
    expect(out.problems).toEqual([])
  })

  test('a body that was ALREADY broken around its variable is not blamed on the render', () => {
    const out = renderSpec(
      spec({ body: { mimeType: 'application/json', text: '{"a": {{v}}' } }),
      vars({ v: '1' }),
    )
    expect(out.problems).toEqual([])
  })

  test('a NON-json body is never second-guessed', () => {
    const out = renderSpec(
      spec({ body: { mimeType: 'text/plain', text: 'hello "{{who}}"' } }),
      vars({ who: 'a"b' }),
    )
    expect(out.problems).toEqual([])
  })

  test('a request with no body has nothing to break', () => {
    expect(renderSpec(spec(), ENV).problems).toEqual([])
  })
})

describe('environments + path parameters — the seam, not each side', () => {
  // Both sides were tested alone: `renderSpec` renders pathParameters, `buildUrl` substitutes
  // them. Nothing exercised the ORDER, which is what actually has to hold — and the same class of
  // gap (two tested modules, an untested composition) is where every bug this loop found lived.
  test('a variable INSIDE a path parameter resolves, then substitutes', () => {
    const out = renderSpec(
      spec({
        url: '{{base_url}}/users/:id',
        pathParameters: [{ name: 'id', value: '{{account}}' }],
      }),
      ENV,
    )
    expect(buildUrl(out.spec).toString()).toBe('https://staging.api.dev/users/acct_1')
  })

  test('an UNDEFINED variable in a path param is reported, and the url stays visibly unfinished', () => {
    const out = renderSpec(
      spec({
        url: 'https://api.dev/users/:id',
        pathParameters: [{ name: 'id', value: '{{nope}}' }],
      }),
      vars({}),
    )
    expect(out.missing).toEqual(['nope'])
    // It must NOT reach the wire as a literal `{{nope}}` — the send paths refuse on `missing`.
    expect(buildUrl(out.spec).toString()).toContain('%7B%7Bnope%7D%7D')
  })

  test('a rendered path param is URL-ENCODED by buildUrl — the render does not bypass that', () => {
    const out = renderSpec(
      spec({ url: 'https://api.dev/u/:id', pathParameters: [{ name: 'id', value: '{{evil}}' }] }),
      vars({ evil: '../admin' }),
    )
    expect(buildUrl(out.spec).toString()).toBe('https://api.dev/u/..%2Fadmin')
  })

  test('the guard sees the SUBSTITUTED host — a variable cannot smuggle one past it', () => {
    // The composition that matters: render puts the host in, buildUrl builds the url, and the
    // guard reads that same url. If any step reordered, a `{{host}}` = 127.0.0.1 would slip.
    const out = renderSpec(spec({ url: '{{base_url}}/x' }), vars({ base_url: 'http://127.0.0.1' }))
    expect(buildUrl(out.spec).hostname).toBe('127.0.0.1')
  })
})
