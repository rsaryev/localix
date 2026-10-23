/**
 * The fix-it helper is the model's error manual, so it is tested like a contract: every guard
 * names the field AND shows a correct call. Pure — no host, no zod, no filesystem.
 */

import { describe, expect, test } from 'bun:test'
import { httpRequestProblem, type HttpRequestInput } from './http-request-schema'

const input = (over: Partial<HttpRequestInput>): HttpRequestInput =>
  ({ action: 'send', ...over }) as HttpRequestInput

describe('httpRequestProblem', () => {
  test('accepts a minimal send', () => {
    expect(httpRequestProblem(input({ url: 'https://api.github.com' }))).toBeNull()
  })

  test('accepts a send that names a saved request instead of a url', () => {
    expect(httpRequestProblem(input({ name: 'github-user' }))).toBeNull()
  })

  test('send with neither url nor name is told both ways out', () => {
    const problem = httpRequestProblem(input({}))
    expect(problem).toContain('"url"')
    expect(problem).toContain('"name"')
  })

  test.each(['get', 'delete', 'save'] as const)('%s without a name is refused', (action) => {
    expect(httpRequestProblem(input({ action }))).toContain('needs a "name"')
  })

  test('save without a url is refused', () => {
    expect(httpRequestProblem(input({ action: 'save', name: 'x' }))).toContain('needs a "url"')
  })

  test('a non-http url is refused with the scheme spelled out', () => {
    const problem = httpRequestProblem(input({ url: 'api.github.com' }))
    expect(problem).toContain('https://')
  })

  test('a file:// url is refused — only http(s) is ours to send', () => {
    expect(httpRequestProblem(input({ url: 'file:///etc/passwd' }))).toContain('not an http(s) URL')
  })

  test('an unknown method lists the supported ones', () => {
    const problem = httpRequestProblem(input({ url: 'https://x.dev', method: 'TRACE' }))
    expect(problem).toContain('GET')
  })

  test('body and form together is refused — they are alternatives', () => {
    const problem = httpRequestProblem(
      input({ url: 'https://x.dev', body: '{}', form: [{ name: 'a', value: '1' }] }),
    )
    expect(problem).toContain('not both')
  })

  test.each([
    [{ timeoutMs: 0 }, 'timeoutMs'],
    [{ timeoutMs: 1.5 }, 'timeoutMs'],
    [{ maxRedirects: 0 }, 'maxRedirects'],
    [{ maxRedirects: 1.5 }, 'maxRedirects'],
  ] as const)('invalid per-request setting %j is refused', (over, field) => {
    expect(httpRequestProblem(input({ url: 'https://x.dev', ...over }))).toContain(field)
  })

  test.each([
    [{ action: 'save', url: 'bad', method: 'TRACE' }, 'needs a "name"'],
    [{ action: 'save', name: 'x', method: 'TRACE' }, 'needs a "url"'],
    [{ action: 'send', method: 'TRACE', authType: 'bearer' }, 'needs a "url"'],
    [{ action: 'import', url: 'bad', timeoutMs: 0 }, 'needs a "source"'],
    [{ action: 'import', source: 'curl https://x.dev', dir: '', url: 'bad' }, 'not both'],
    [{ url: 'bad', method: 'TRACE', timeoutMs: 0 }, 'not an http(s) URL'],
    [
      { url: 'https://x.dev', method: 'TRACE', body: '{}', form: [{ name: 'a', value: 'b' }] },
      'not a supported method',
    ],
    [
      { url: 'https://x.dev', body: '{}', form: [{ name: 'a', value: 'b' }], timeoutMs: 0 },
      'not both',
    ],
    [{ url: 'https://x.dev', timeoutMs: 0, maxRedirects: 0, authType: 'bearer' }, '"timeoutMs"'],
    [{ url: 'https://x.dev', maxRedirects: 0, authType: 'bearer' }, '"maxRedirects"'],
  ] as const)('preserves the first actionable error for %j', (over, message) => {
    expect(httpRequestProblem(input(over as Partial<HttpRequestInput>))).toContain(message)
  })

  describe('auth guards', () => {
    test('basic needs both halves', () => {
      expect(
        httpRequestProblem(input({ url: 'https://x.dev', authType: 'basic', username: 'ada' })),
      ).toContain('"password"')
    })

    test('bearer needs a token', () => {
      expect(httpRequestProblem(input({ url: 'https://x.dev', authType: 'bearer' }))).toContain(
        '"token"',
      )
    })

    test('apikey needs a name and a value', () => {
      expect(
        httpRequestProblem(input({ url: 'https://x.dev', authType: 'apikey', apiKeyName: 'K' })),
      ).toContain('apiKeyValue')
    })

    test('a complete bearer auth passes', () => {
      expect(
        httpRequestProblem(
          input({ url: 'https://x.dev', authType: 'bearer', token: '${secret:GH}' }),
        ),
      ).toBeNull()
    })
  })
})

describe('a templated url is accepted — validation waits for the render', () => {
  // REGRESSION: `isHttpUrl('{{base_url}}/users')` is false, so this guard refused to SAVE any
  // request using a variable — the entire environments feature was unusable at its front door.
  // No unit test caught it: render-spec was tested in isolation, never the save→send path. The
  // check now happens after the render, where a url finally exists.
  test.each(['{{base_url}}/users/octocat', '{{ base_url }}/users', '{{scheme}}://{{host}}/v1'])(
    '%p saves',
    (url) => {
      expect(httpRequestProblem(input({ action: 'save', name: 'x', url }))).toBeNull()
    },
  )

  test('a NON-templated bad url is still refused up front', () => {
    expect(httpRequestProblem(input({ url: 'api.github.com' }))).toContain('not an http(s) URL')
  })

  test('the refusal mentions variables as the other legitimate shape', () => {
    expect(httpRequestProblem(input({ url: 'api.github.com' }))).toContain('{{base_url}}')
  })
})

/**
 * The four guards below were found by MUTATION, not by reading: each was neutralised
 * (`if (…)` → `if (false)`) and the whole 898-test suite stayed green. This file's own header
 * claims "every guard names the field AND shows a correct call" — for these four it was prose.
 * That is the same failure the send.ts header warns about, one directory over.
 */
describe('guards that survived a mutation sweep — untested until now', () => {
  describe('action="import" needs exactly one source of input', () => {
    test('neither "source" nor "dir" is refused, and both are named', () => {
      const problem = httpRequestProblem(input({ action: 'import' }))
      expect(problem).toContain('source')
      expect(problem).toContain('dir')
    })

    test('BOTH is refused — it is ambiguous, not additive', () => {
      const problem = httpRequestProblem(
        input({ action: 'import', source: 'curl https://a.dev', dir: '.localix/rest' }),
      )
      expect(problem).toContain('not both')
    })

    test.each([
      [{ source: 'curl https://a.dev' }, 'source alone'],
      [{ dir: '.localix/rest' }, 'dir alone'],
      [{ dir: '' }, 'an empty dir is still a dir — the default directory'],
    ])('%j is accepted (%s)', (over) => {
      expect(httpRequestProblem(input({ action: 'import', ...over }))).toBeNull()
    })
  })
})
