/**
 * The cURL serializer's one non-negotiable claim: a real credential NEVER reaches exported text.
 *
 * A curl string is the most copy-pasteable artifact this mini app makes — into a chat, an issue, a
 * shell history — so the test that matters is that a literal is MASKED while a `${secret:KEY}`
 * reference (a pointer, not a secret) survives verbatim, keeping the command reproducible.
 */

import { describe, expect, test } from 'bun:test'
import { toCurl } from './curl'
import type { RequestSpec } from '../request-spec'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/x',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

describe('a credential never reaches exported text', () => {
  test('a literal bearer token is MASKED, not serialized', () => {
    const out = toCurl(spec({ auth: { type: 'bearer', token: 'sk-literal-secret' } }))
    expect(out).not.toContain('sk-literal-secret')
    expect(out).toContain('Authorization: Bearer ••••••')
  })

  test('a ${secret:KEY} reference is kept VERBATIM — it is a pointer, not a secret', () => {
    const out = toCurl(spec({ auth: { type: 'bearer', token: '${secret:GH_TOKEN}' } }))
    expect(out).toContain('${secret:GH_TOKEN}')
  })

  test('a literal basic password is masked in `-u`', () => {
    const out = toCurl(spec({ auth: { type: 'basic', username: 'ada', password: 'hunter2' } }))
    expect(out).not.toContain('hunter2')
    expect(out).toContain("-u 'ada:••••••'")
  })

  test('a credential-bearing HEADER is masked too', () => {
    const out = toCurl(spec({ headers: [{ name: 'Authorization', value: 'Token ghp_raw' }] }))
    expect(out).not.toContain('ghp_raw')
    expect(out).toContain('••••••')
  })
})

describe('the command reproduces the request', () => {
  test('non-GET methods are stated with -X', () => {
    expect(toCurl(spec({ method: 'DELETE' }))).toContain('curl -X DELETE')
  })

  test('a GET carries no -X', () => {
    expect(toCurl(spec())).toMatch(/^curl '/)
  })

  test('enabled query pairs are appended, disabled ones dropped', () => {
    const out = toCurl(
      spec({
        query: [
          { name: 'a', value: '1' },
          { name: 'skip', value: 'x', disabled: true },
        ],
      }),
    )
    expect(out).toContain('a=1')
    expect(out).not.toContain('skip')
  })

  test('a template url is kept as-written — the export represents the SAVED request', () => {
    expect(toCurl(spec({ url: '{{base_url}}/users' }))).toContain('{{base_url}}/users')
  })

  test('a filled path parameter is substituted', () => {
    const out = toCurl(
      spec({ url: 'https://api.dev/u/:id', pathParameters: [{ name: 'id', value: '42' }] }),
    )
    expect(out).toContain('https://api.dev/u/42')
  })

  test('a text body becomes --data-raw with its Content-Type', () => {
    const out = toCurl(
      spec({ method: 'POST', body: { mimeType: 'application/json', text: '{"a":1}' } }),
    )
    expect(out).toContain('--data-raw \'{"a":1}\'')
    expect(out).toContain('Content-Type: application/json')
  })

  test('a urlencoded form uses --data-urlencode per field', () => {
    const out = toCurl(
      spec({
        method: 'POST',
        body: {
          mimeType: 'application/x-www-form-urlencoded',
          form: [{ name: 'k', value: 'v' }],
        },
      }),
    )
    expect(out).toContain("--data-urlencode 'k=v'")
  })

  test('a multipart form uses -F, and NO manual Content-Type (curl writes the boundary)', () => {
    const out = toCurl(
      spec({
        method: 'POST',
        body: { mimeType: 'multipart/form-data', form: [{ name: 'k', value: 'v' }] },
      }),
    )
    expect(out).toContain("-F 'k=v'")
    expect(out).not.toContain('Content-Type: multipart/form-data')
  })

  test('a request that follows redirects adds -L; one that opted out does not', () => {
    expect(toCurl(spec())).toContain('-L') // default: follows
    expect(toCurl(spec({ followRedirects: false }))).not.toContain('-L')
  })

  test('an apikey in the query is folded into the url, masked', () => {
    const out = toCurl(
      spec({ auth: { type: 'apikey', key: 'api_key', value: 'literal-key', addTo: 'query' } }),
    )
    expect(out).not.toContain('literal-key')
    expect(out).toContain('api_key=')
    // Not a header — it belongs in the url, where the SSRF guard would have checked it.
    expect(out).not.toContain('-H')
  })
})
