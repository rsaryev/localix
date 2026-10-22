/**
 * Rendering a response for the model — the status line, the interesting headers, the body verbatim.
 */

import { describe, expect, test } from 'bun:test'
import { formatResponse, interestingHeaders, prettyBody } from './format-response'
import type { SendResult } from './send'
import type { RequestSpec } from './request-spec'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/x',
  method: 'POST',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const res = (over: Partial<SendResult> = {}): SendResult => ({
  status: 200,
  statusText: 'OK',
  url: 'https://api.dev/x',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  bytes: 2,
  truncated: false,
  elapsedMs: 10,
  hops: [{ url: 'https://api.dev/x', status: 200, elapsedMs: 10 }],
  ...over,
})

describe('the status line', () => {
  test('says method, url, status and time', () => {
    expect(formatResponse(spec({ method: 'GET' }), res())).toContain(
      'GET https://api.dev/x → 200 OK (10ms)',
    )
  })

  test('redirects are shown when there were any', () => {
    // `hops` is structured now; the redirect line joins the destination urls.
    const out = formatResponse(
      spec(),
      res({
        hops: [
          { url: 'https://a.dev', status: 302, elapsedMs: 3 },
          { url: 'https://b.dev', status: 200, elapsedMs: 4 },
        ],
      }),
    )
    expect(out).toContain('https://a.dev → https://b.dev')
  })

  test('truncation is announced', () => {
    expect(formatResponse(spec(), res({ truncated: true, bytes: 999 }))).toContain('truncated')
  })

  test('an empty body says so rather than showing nothing', () => {
    expect(formatResponse(spec(), res({ body: '' }))).toContain('(empty body)')
  })
})

describe('interestingHeaders', () => {
  test('keeps the ones that change what to do next', () => {
    const out = interestingHeaders({
      'content-type': 'application/json',
      'retry-after': '30',
      'x-ratelimit-remaining': '0',
      'cf-ray': 'noise',
      'x-served-by': 'noise',
    })
    expect(Object.keys(out).sort()).toEqual([
      'content-type',
      'retry-after',
      'x-ratelimit-remaining',
    ])
  })
})

describe('prettyBody', () => {
  test('pretty-prints JSON', () => {
    expect(prettyBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}')
  })

  test('leaves non-JSON alone', () => {
    expect(prettyBody('<html>', 'text/html')).toBe('<html>')
  })

  test('a lying content-type does not lose the body', () => {
    expect(prettyBody('not json', 'application/json')).toBe('not json')
  })
})

describe('a missing reason phrase does not leave a hole', () => {
  test('HTTP/2 sends no statusText — the line stays readable', () => {
    // Real HTTP/2 responses have `statusText: ''`; joining blindly gives `200  (10ms)`.
    expect(formatResponse(spec({ method: 'POST' }), res({ statusText: '' }))).toContain(
      '→ 200 (10ms)',
    )
  })

  test('an HTTP/1.1 reason phrase is still shown', () => {
    expect(formatResponse(spec(), res({ status: 404, statusText: 'Not Found' }))).toContain(
      '→ 404 Not Found (10ms)',
    )
  })
})

describe('a garbled body warns ABOVE the body', () => {
  // Without this the field is one nobody reads — the `operationType` failure exactly: a detector
  // that exists, is tested, and is wired to nothing.
  const garbled = (charsetProblem?: string) =>
    formatResponse(spec(), res({ body: '������', ...(charsetProblem ? { charsetProblem } : {}) }))

  test('the warning is rendered', () => {
    expect(
      garbled('The server sent this as `charset=utf-7`, which this runtime cannot decode.'),
    ).toContain('utf-7')
  })

  test('it comes BEFORE the body — after it is no use to someone who already believed it', () => {
    const out = garbled('CHARSET-WARNING')
    expect(out.indexOf('CHARSET-WARNING')).toBeLessThan(out.indexOf('������'))
  })

  test('a normal response says nothing about charsets', () => {
    expect(garbled()).not.toMatch(/charset/i)
  })
})
