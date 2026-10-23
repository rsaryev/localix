/**
 * The repo file format, and the rule that keeps credentials out of git history.
 *
 * `gitSafetyProblem` is the load-bearing test here. Everything else in this mini app can be fixed
 * by a later commit; a credential committed once cannot — it stays readable in history forever, and
 * the only real remedy is rotating the secret and rewriting history.
 */

import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  buildRequestFile,
  gitSafetyProblem,
  parseRequestFile,
  requestFileName,
  REQUEST_FILE_VERSION,
} from './format'
import type { RequestSpec } from '../request-spec'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.github.com/users/octocat',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

describe('a literal credential is REFUSED, not redacted', () => {
  test.each([
    ['bearer', { type: 'bearer', token: 'ghp_SECRET' }],
    ['basic', { type: 'basic', username: 'ada', password: 'hunter2' }],
    ['apikey', { type: 'apikey', key: 'X-Api-Key', value: 'sk_live_abc' }],
  ] as const)('a literal %s auth is refused', (_type, auth) => {
    const problem = gitSafetyProblem('gh', spec({ auth: auth as never }))
    expect(problem).not.toBeNull()
    expect(problem).toContain('git history')
  })

  test('the refusal says what to DO, not just what went wrong', () => {
    const problem = gitSafetyProblem('gh', spec({ auth: { type: 'bearer', token: 'ghp_x' } }))
    expect(problem).toContain('${secret:KEY}')
  })

  test('redacting instead would be worse — the message explains the choice is deliberate', () => {
    // A redacted export is a request that no longer works, shipped to a teammate who cannot tell.
    const problem = gitSafetyProblem('gh', spec({ auth: { type: 'bearer', token: 'ghp_x' } }))
    expect(problem).toContain('NOT exported')
  })
})

describe('a ${secret:} REFERENCE is safe to commit', () => {
  test.each([
    { type: 'bearer', token: '${secret:GH_TOKEN}' },
    { type: 'basic', username: 'ada', password: '${secret:GH_PASS}' },
    { type: 'apikey', key: 'X-Api-Key', value: '${secret:API_KEY}' },
  ] as const)('%j exports', (auth) => {
    // This is the argument for references, made concrete: a pointer is shareable BY CONSTRUCTION.
    // The team gets the request; each member's own vault supplies the key.
    expect(gitSafetyProblem('gh', spec({ auth: auth as never }))).toBeNull()
  })

  test('auth=none is safe', () => {
    expect(gitSafetyProblem('gh', spec())).toBeNull()
  })

  test('an EMPTY credential is safe — there is nothing to leak', () => {
    expect(gitSafetyProblem('gh', spec({ auth: { type: 'bearer', token: '' } }))).toBeNull()
  })
})

describe('the check is narrow, on purpose', () => {
  test('an AMBIGUOUS header name is not blocked', () => {
    // The line is drawn at ambiguity, not at spec provenance. Whether `X-Trace` holds a secret cannot
    // be known: a guess that says yes blocks legitimate exports, one that says no lends false
    // confidence. A header NAMED `X-Api-Key` is not in that category — see the next block.
    expect(
      gitSafetyProblem('gh', spec({ headers: [{ name: 'X-Trace', value: 'abc123' }] })),
    ).toBeNull()
    expect(
      gitSafetyProblem('gh', spec({ headers: [{ name: 'X-Request-Id', value: 'req-1' }] })),
    ).toBeNull()
  })

  test.each(['X-Api-Key', 'api-key', 'X-Auth-Token', 'Private-Token', 'X-Amz-Security-Token'])(
    'a literal %s header IS refused — the name states what the value is',
    (name) => {
      // The remaining half of the same composition bug. `gitSafetyProblem` refused a credential in
      // `Authorization`/`Cookie` but exported an API key in the header every REST API actually uses
      // for one — straight into the user's repository, where git history keeps it readable forever.
      const problem = gitSafetyProblem('svc', spec({ headers: [{ name, value: 'sk-live-abc' }] }))
      expect(problem).not.toBeNull()
      expect(problem).toContain('git history')
    },
  )

  test('a ${secret:} reference in an API-key header exports freely', () => {
    expect(
      gitSafetyProblem(
        'svc',
        spec({ headers: [{ name: 'X-Api-Key', value: '${secret:STRIPE_KEY}' }] }),
      ),
    ).toBeNull()
  })
})

describe('round trip', () => {
  test('build → parse', () => {
    const file = buildRequestFile('github-user', spec())
    expect(parseRequestFile(JSON.stringify(file))).toEqual(file)
  })

  test('the file identifies its format — a bare spec would be ambiguous', () => {
    expect(buildRequestFile('x', spec()).localixRestRequest).toBe(REQUEST_FILE_VERSION)
  })

  test.each([
    'not json',
    '{}',
    JSON.stringify({ name: 'x', spec: {} }),
    JSON.stringify({ localixRestRequest: 999, name: 'x', spec: {} }),
    JSON.stringify({ localixRestRequest: 1, name: 'x' }),
    JSON.stringify({ localixRestRequest: 1, name: 'x', spec: { url: 'x' } }),
    JSON.stringify({ log: { entries: [] } }),
  ])('%p is not one of our files', (text) => {
    expect(parseRequestFile(text)).toBeNull()
  })
})

describe('requestFileName is a path boundary, not just formatting', () => {
  test('a traversal cannot decide where we write', () => {
    // Every separator collapses, and the leading dot goes too — so a name aimed at `.ssh/config`
    // cannot even produce a dotfile, let alone escape the directory.
    expect(requestFileName('../../.ssh/config')).toBe('ssh-config.json')
    expect(requestFileName('../../../etc/passwd')).toBe('etc-passwd.json')
  })

  test('the REAL invariant: the joined path never leaves the directory', () => {
    // Asserting "the name contains no `..`" would be a PROXY, and a wrong one: `a/../../b` slugs
    // to `a-..-..-b.json`, which holds `..` and is perfectly safe — with no separator those are
    // literal characters in one filename, not path segments. What actually matters is where
    // `path.join` lands, so that is what this asserts.
    const dir = '/tmp/export'
    for (const evil of [
      '../x',
      '..\\x',
      '/etc/passwd',
      'a/../../b',
      '../../.ssh/config',
      '....//....//x',
      'x/./../../y',
    ]) {
      const resolved = path.resolve(dir, requestFileName(evil))
      expect(path.dirname(resolved)).toBe(dir)
    }
  })

  test.each([
    ['github-user', 'github-user.json'],
    ['api v1 things', 'api-v1-things.json'],
    ['weird/name', 'weird-name.json'],
  ])('%p → %p', (name, expected) => {
    expect(requestFileName(name)).toBe(expected)
  })

  test('a name with nothing usable still yields a legal file', () => {
    expect(requestFileName('///')).toBe('request.json')
  })

  test('an absurd name is bounded', () => {
    expect(requestFileName('x'.repeat(500)).length).toBeLessThanOrEqual(105)
  })
})

describe('a credential in the QUERY STRING is refused too', () => {
  // `buildRequestFile` writes the whole spec, `url` and `query` included, and `gitSafetyProblem`
  // checked neither — so `?api_key=sk-live-…` went into a file in the user's repository, where git
  // history keeps it readable forever. Same outcome the header check exists to prevent, other half of
  // the request line.
  test.each(['api_key', 'access_token', 'token', 'client_secret', 'password', 'signature'])(
    'a literal %s inline in the url is refused',
    (param) => {
      const problem = gitSafetyProblem(
        'svc',
        spec({ url: `https://api.dev/x?${param}=sk-live-abc` }),
      )
      expect(problem).not.toBeNull()
      expect(problem).toContain('git history')
      expect(problem).toContain(param)
    },
  )

  test('a literal in a query PAIR is refused', () => {
    const problem = gitSafetyProblem(
      'svc',
      spec({ query: [{ name: 'api_key', value: 'sk-live-abc' }] }),
    )
    expect(problem).not.toBeNull()
  })

  test('an AMBIGUOUS parameter name still exports — the line is ambiguity, not suspicion', () => {
    expect(gitSafetyProblem('svc', spec({ url: 'https://api.dev/x?key=abc&sort=name' }))).toBeNull()
    expect(gitSafetyProblem('svc', spec({ query: [{ name: 'page', value: '2' }] }))).toBeNull()
  })

  test('a ${secret:} reference in the query exports freely', () => {
    expect(
      gitSafetyProblem('svc', spec({ url: 'https://api.dev/x?api_key=${secret:STRIPE}' })),
    ).toBeNull()
    expect(
      gitSafetyProblem('svc', spec({ query: [{ name: 'token', value: '${secret:GH}' }] })),
    ).toBeNull()
  })

  test('an EMPTY credential parameter is safe — there is nothing to leak', () => {
    expect(gitSafetyProblem('svc', spec({ url: 'https://api.dev/x?api_key=' }))).toBeNull()
  })
})

describe('a credential in a HEADER is refused too — the composition bug', () => {
  // The hole this closes: for fourteen iterations `gitSafetyProblem` checked `spec.auth` only, on
  // the argument that "auth is the one place this mini app promises to hold credentials" — while
  // `import/har.ts` puts a logged-in session's Authorization AND Cookie straight into headers by
  // design, and `import/curl.ts` leaves any auth scheme it cannot sign there. Import a HAR from a
  // logged-in tab → export → commit → the session is in git history forever, which is the exact
  // outcome this module exists to prevent. Each module's comment was true; the composition was not.
  test.each(['Authorization', 'authorization', 'Cookie', 'Proxy-Authorization'])(
    'a literal %s header is refused',
    (name) => {
      const problem = gitSafetyProblem(
        'har-import',
        spec({ headers: [{ name, value: 'Bearer ghp_x' }] }),
      )
      expect(problem).not.toBeNull()
      expect(problem).toContain('git history')
    },
  )

  test('the real HAR shape — a session cookie — is refused', () => {
    const problem = gitSafetyProblem(
      'logged-in',
      spec({ headers: [{ name: 'Cookie', value: 'session=abc123' }] }),
    )
    expect(problem).toContain('HAR import')
  })

  test('a curl scheme we could not sign, kept as a header, is refused', () => {
    // `Authorization: Token …` is GitHub's own documented form and curl.ts keeps it as a header.
    expect(
      gitSafetyProblem('gh', spec({ headers: [{ name: 'Authorization', value: 'Token abc' }] })),
    ).not.toBeNull()
  })

  test('a ${secret:} reference in a header exports — a pointer is still a pointer', () => {
    expect(
      gitSafetyProblem(
        'gh',
        spec({ headers: [{ name: 'Authorization', value: 'Bearer ${secret:GH}' }] }),
      ),
    ).toBeNull()
  })

  test('an ordinary header is NOT blocked — this is still not a scanner', () => {
    expect(
      gitSafetyProblem('gh', spec({ headers: [{ name: 'X-Trace', value: 'abc123' }] })),
    ).toBeNull()
  })

  test('an empty credential header is nothing to leak', () => {
    expect(
      gitSafetyProblem('gh', spec({ headers: [{ name: 'Authorization', value: '' }] })),
    ).toBeNull()
  })
})
