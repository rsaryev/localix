/**
 * The curl importer, covered with real commands — the kind a person actually pastes: copied from
 * API docs, from a browser's "Copy as cURL", and with the awkward flags that break naive parsers.
 */

import { describe, expect, test } from 'bun:test'
import { convertCurl, suggestName } from './curl'

/** The single spec a well-formed command imports to. */
const one = (command: string) => {
  const out = convertCurl(command)
  expect(out, `expected curl to claim: ${command}`).not.toBeNull()
  expect(out!).toHaveLength(1)
  return out![0].spec
}

describe('format sniffing', () => {
  test.each([
    'GET https://api.dev',
    '{"log":{"entries":[]}}',
    'https://api.dev',
    'wget https://api.dev',
  ])('%p is not a curl command', (text) => {
    expect(convertCurl(text)).toBeNull()
  })

  test('a copied shell prompt does not defeat the sniff', () => {
    expect(one('$ curl https://api.dev/x').url).toBe('https://api.dev/x')
  })

  test('curl with no url at all is refused rather than imported blank', () => {
    expect(convertCurl('curl -X POST')).toBeNull()
  })
})

describe('url and method', () => {
  test('a bare url with no flags is a GET', () => {
    const spec = one('curl https://api.github.com/users/octocat')
    expect(spec.method).toBe('GET')
    expect(spec.url).toBe('https://api.github.com/users/octocat')
  })

  test('the query string is split out of the url into pairs', () => {
    const spec = one('curl "https://api.dev/search?q=cats&page=2"')
    expect(spec.url).toBe('https://api.dev/search')
    expect(spec.query).toEqual([
      { name: 'q', value: 'cats' },
      { name: 'page', value: '2' },
    ])
  })

  test('an unquoted query URL survives shell-quote glob tokens', () => {
    const out = convertCurl('curl https://api.dev/users?page=2')
    expect(out?.[0]?.spec.url).toBe('https://api.dev/users')
    expect(out?.[0]?.spec.query).toEqual([{ name: 'page', value: '2' }])
  })

  test('-X sets the method', () => {
    expect(one('curl -X DELETE https://api.dev/x').method).toBe('DELETE')
  })

  test('a squished -XPOST is still a method', () => {
    expect(one('curl -XPOST https://api.dev/x').method).toBe('POST')
  })

  test('--request is the long form of -X', () => {
    expect(one('curl --request PUT https://api.dev/x').method).toBe('PUT')
  })

  test('a body with no -X implies POST, as curl itself does', () => {
    expect(one(`curl -d 'a=1' https://api.dev/x`).method).toBe('POST')
  })

  test('-X wins over the body-implies-POST default', () => {
    expect(one(`curl -X PATCH -d 'a=1' https://api.dev/x`).method).toBe('PATCH')
  })

  test('-I is a HEAD request', () => {
    expect(one('curl -I https://api.dev/x').method).toBe('HEAD')
  })

  test('--url names the url explicitly', () => {
    expect(one('curl --url https://api.dev/x').url).toBe('https://api.dev/x')
  })
})

describe('the ignored-but-valued flag trap', () => {
  test('-o consumes its value instead of leaving it to be read as the url', () => {
    const spec = one('curl -o out.json https://api.dev/x')
    expect(spec.url).toBe('https://api.dev/x')
  })

  test('--max-time consumes its value too', () => {
    expect(one('curl --max-time 30 https://api.dev/x').url).toBe('https://api.dev/x')
  })

  test('several ignored valued flags in a row all consume', () => {
    const spec = one('curl -o out.json --connect-timeout 5 -A "Mozilla/5.0" https://api.dev/x')
    expect(spec.url).toBe('https://api.dev/x')
  })

  test('an unknown boolean flag does not eat the url', () => {
    expect(one('curl --insecure https://api.dev/x').url).toBe('https://api.dev/x')
  })
})

describe('headers', () => {
  test('-H is read, and repeats accumulate', () => {
    const spec = one(`curl -H 'Accept: application/json' -H 'X-Trace: 1' https://api.dev/x`)
    expect(spec.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Trace', value: '1' },
    ])
  })

  test('a header value containing a colon survives — split on the FIRST colon only', () => {
    const spec = one(`curl -H 'X-Origin: https://other.dev:8443/a' https://api.dev/x`)
    expect(spec.headers).toEqual([{ name: 'X-Origin', value: 'https://other.dev:8443/a' }])
  })

  test('--header is the long form', () => {
    expect(one(`curl --header 'Accept: text/plain' https://api.dev/x`).headers).toEqual([
      { name: 'Accept', value: 'text/plain' },
    ])
  })

  test('--compressed adds an Accept-Encoding when none was given', () => {
    const spec = one('curl --compressed https://api.dev/x')
    expect(spec.headers).toEqual([{ name: 'Accept-Encoding', value: 'deflate, gzip' }])
  })

  test('--compressed does not override an explicit Accept-Encoding', () => {
    const spec = one(`curl --compressed -H 'Accept-Encoding: br' https://api.dev/x`)
    expect(spec.headers).toEqual([{ name: 'Accept-Encoding', value: 'br' }])
  })
})

describe('auth is lifted out of headers so it can be vaulted', () => {
  test('a bearer Authorization header becomes bearer auth, not a raw header', () => {
    const spec = one(`curl -H 'Authorization: Bearer ghp_abc123' https://api.dev/x`)
    expect(spec.auth).toEqual({ type: 'bearer', token: 'ghp_abc123' })
    expect(spec.headers).toEqual([])
  })

  test('a basic Authorization header is decoded back into username/password', () => {
    const encoded = btoa('ada:hunter2')
    const spec = one(`curl -H 'Authorization: Basic ${encoded}' https://api.dev/x`)
    expect(spec.auth).toEqual({ type: 'basic', username: 'ada', password: 'hunter2' })
    expect(spec.headers).toEqual([])
  })

  test('-u becomes basic auth', () => {
    const spec = one('curl -u ada:hunter2 https://api.dev/x')
    expect(spec.auth).toEqual({ type: 'basic', username: 'ada', password: 'hunter2' })
  })

  test('a password containing a colon is kept whole', () => {
    const spec = one('curl -u ada:pa:ss https://api.dev/x')
    expect(spec.auth).toEqual({ type: 'basic', username: 'ada', password: 'pa:ss' })
  })

  test('an auth scheme we cannot sign is kept as a header rather than guessed at', () => {
    const spec = one(`curl -H 'Authorization: Negotiate abc' https://api.dev/x`)
    expect(spec.auth).toEqual({ type: 'none' })
    expect(spec.headers).toEqual([{ name: 'Authorization', value: 'Negotiate abc' }])
  })
})

describe('body', () => {
  test('-d with a JSON content-type is a text body', () => {
    const spec = one(
      `curl -X POST -H 'Content-Type: application/json' -d '{"name":"Ada"}' https://api.dev/x`,
    )
    expect(spec.body).toEqual({ mimeType: 'application/json', text: '{"name":"Ada"}' })
  })

  test('-d with no content-type defaults to form-urlencoded, as curl does', () => {
    const spec = one(`curl -d 'a=1&b=2' https://api.dev/x`)
    expect(spec.body?.mimeType).toBe('application/x-www-form-urlencoded')
  })

  test('-d with an explicit form content-type parses into form pairs', () => {
    const spec = one(
      `curl -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2' https://api.dev/x`,
    )
    expect(spec.body?.form).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
  })

  test('repeated -d values are joined with &, as curl does', () => {
    const spec = one(`curl -d 'a=1' -d 'b=2' https://api.dev/x`)
    expect(spec.body?.text).toBe('a=1&b=2')
  })

  test('a JSON -d body with no content-type is NOT mangled into form pairs', () => {
    // curl sends `-d` verbatim under a default form-urlencoded content-type; it does not
    // re-encode. Parsing this into pairs would invent a field named `{"name":"Ada"}`, so pairs
    // are only ever parsed when a content-type explicitly claims them (the test above).
    const spec = one(`curl -d '{"name":"Ada"}' https://api.dev/x`)
    expect(spec.body?.text).toBe('{"name":"Ada"}')
    expect(spec.body?.form).toBeUndefined()
  })

  test('--data-raw is a body too', () => {
    const spec = one(
      `curl -H 'Content-Type: application/json' --data-raw '{"a":1}' https://api.dev/x`,
    )
    expect(spec.body?.text).toBe('{"a":1}')
  })

  test('--data-urlencode encodes the value but not the name', () => {
    const spec = one(`curl --data-urlencode 'q=a b&c' https://api.dev/x`)
    expect(spec.body?.text).toBe('q=a%20b%26c')
  })

  test('--data-urlencode with no = encodes the whole value', () => {
    const spec = one(`curl --data-urlencode 'a b&c' https://api.dev/x`)
    expect(spec.body?.text).toBe('a%20b%26c')
  })

  test('-F is a multipart form', () => {
    const spec = one('curl -F name=Ada -F role=admin https://api.dev/x')
    expect(spec.body?.mimeType).toBe('multipart/form-data')
    expect(spec.body?.form).toEqual([
      { name: 'name', value: 'Ada' },
      { name: 'role', value: 'admin' },
    ])
  })

  test('-G moves the data onto the query string and leaves no body', () => {
    const spec = one(`curl -G -d 'q=cats' -d 'page=2' https://api.dev/search`)
    expect(spec.method).toBe('GET')
    expect(spec.body).toBeUndefined()
    expect(spec.query).toEqual([
      { name: 'q', value: 'cats' },
      { name: 'page', value: '2' },
    ])
  })
})

describe('cookies', () => {
  test('-b becomes a Cookie header', () => {
    const spec = one('curl -b session=abc https://api.dev/x')
    expect(spec.headers).toEqual([{ name: 'Cookie', value: 'session=abc' }])
  })

  test('-b merges into an existing Cookie header rather than replacing it', () => {
    const spec = one(`curl -H 'Cookie: theme=dark' -b session=abc https://api.dev/x`)
    expect(spec.headers).toEqual([{ name: 'Cookie', value: 'theme=dark; session=abc' }])
  })
})

describe('redirects are imported faithfully', () => {
  test('no -L means curl would not follow, so neither do we', () => {
    expect(one('curl https://api.dev/x').followRedirects).toBe(false)
  })

  test('-L means follow', () => {
    expect(one('curl -L https://api.dev/x').followRedirects).toBe(true)
  })

  test('--location is the long form', () => {
    expect(one('curl --location https://api.dev/x').followRedirects).toBe(true)
  })
})

describe('real-world shapes', () => {
  test('a multi-line command copied from docs', () => {
    const spec = one(`curl -X POST https://api.stripe.com/v1/charges \\
      -u sk_test_abc: \\
      -H 'Content-Type: application/x-www-form-urlencoded' \\
      -d 'amount=2000' \\
      -d 'currency=usd'`)
    expect(spec.method).toBe('POST')
    expect(spec.url).toBe('https://api.stripe.com/v1/charges')
    expect(spec.auth).toEqual({ type: 'basic', username: 'sk_test_abc', password: '' })
    expect(spec.body?.form).toEqual([
      { name: 'amount', value: '2000' },
      { name: 'currency', value: 'usd' },
    ])
  })

  test('a browser "Copy as cURL" with many headers', () => {
    const spec = one(`curl 'https://api.dev/v1/me' \\
      -H 'accept: application/json' \\
      -H 'authorization: Bearer eyJhbGc' \\
      -H 'user-agent: Mozilla/5.0' \\
      --compressed`)
    expect(spec.url).toBe('https://api.dev/v1/me')
    expect(spec.auth).toEqual({ type: 'bearer', token: 'eyJhbGc' })
    expect(spec.headers.map((h) => h.name)).toEqual(['accept', 'user-agent', 'Accept-Encoding'])
  })

  test('a piped command imports the curl part and drops the pipe', () => {
    const spec = one('curl https://api.dev/x | jq .name')
    expect(spec.url).toBe('https://api.dev/x')
  })
})

describe('suggestName', () => {
  test.each([
    ['https://api.github.com/users/octocat', 'api-users-octocat'],
    ['https://api.dev/v1/me', 'api-v1-me'],
    ['https://api.dev/', 'api'],
  ])('%p → %p', (url, expected) => {
    expect(suggestName(url)).toBe(expected)
  })

  test('an unparseable url still yields a usable name', () => {
    expect(suggestName('not a url')).toBe('imported-request')
  })
})

describe('--oauth2-bearer is a bearer token, not a flag to skip', () => {
  test('it becomes bearer auth', () => {
    // It sat in IGNORED_VALUE_FLAGS, so the token was consumed and DISCARDED — the request
    // imported unauthenticated and said nothing. curl sends it as `Authorization: Bearer <token>`.
    expect(one('curl --oauth2-bearer ghp_abc123 https://api.dev/x').auth).toEqual({
      type: 'bearer',
      token: 'ghp_abc123',
    })
  })

  test('the token is not mistaken for the url', () => {
    // The trap the ignored-but-valued list exists for, in reverse: now that the flag is READ, its
    // value must still not leak into the url.
    expect(one('curl --oauth2-bearer ghp_abc123 https://api.dev/x').url).toBe('https://api.dev/x')
  })

  test('an explicit Authorization header still wins', () => {
    const spec = one(
      `curl -H 'Authorization: Bearer explicit' --oauth2-bearer flag https://api.dev/x`,
    )
    expect(spec.auth).toEqual({ type: 'bearer', token: 'explicit' })
  })

  test('it beats -u, as curl documents', () => {
    expect(one('curl -u ada:pw --oauth2-bearer tok https://api.dev/x').auth).toEqual({
      type: 'bearer',
      token: 'tok',
    })
  })
})
