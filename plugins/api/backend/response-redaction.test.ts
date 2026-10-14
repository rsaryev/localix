import { describe, expect, test } from 'bun:test'
import {
  redactResponseSecrets,
  requestCredentialValues,
  resolvedSecretValues,
} from './response-redaction'
import type { RequestSpec } from './request-spec'

describe('resolved environment secret values', () => {
  test('extracts the literal without the safe template around it', () => {
    expect(resolvedSecretValues('Bearer ${secret:TOKEN}', 'Bearer top-secret')).toEqual([
      'top-secret',
    ])
  })

  test('an entire secret variable yields its entire wire value', () => {
    expect(resolvedSecretValues('${secret:TOKEN}', 'top-secret')).toEqual(['top-secret'])
  })
})

describe('wire credential collection', () => {
  test('covers auth, credential headers, cookies, query pairs and inline URL params', () => {
    const spec: RequestSpec = {
      url: 'https://api.dev/x?access_token=url-secret',
      method: 'GET',
      headers: [
        { name: 'Cookie', value: 'sid=cookie-secret; theme=dark' },
        { name: 'X-Trace', value: 'not-a-credential' },
      ],
      query: [{ name: 'api_key', value: 'query-secret' }],
      auth: { type: 'bearer', token: 'auth-secret' },
    }
    const values = requestCredentialValues(
      spec,
      new URL(
        'https://wire-user:wire-password@api.dev/x?access_token=url-secret&api_key=query-secret',
      ),
      [...spec.headers, { name: 'Authorization', value: 'Bearer auth-secret' }],
      ['environment-secret'],
    )

    for (const secret of [
      'url-secret',
      'query-secret',
      'cookie-secret',
      'auth-secret',
      'Bearer auth-secret',
      'environment-secret',
      'wire-user',
      'wire-password',
    ]) {
      expect(values).toContain(secret)
    }
    expect(values).not.toContain('not-a-credential')
  })
})

describe('reflected response redaction', () => {
  test('scrubs body, headers, URL, hops and cookies before any caller sees them', () => {
    const value = 'top-secret'
    const response = redactResponseSecrets(
      {
        url: `https://api.dev/x?token=${value}`,
        headers: { 'x-echo': value },
        body: `{"authorization":"Bearer ${value}"}`,
        hops: [{ url: `https://api.dev/x?token=${value}`, status: 200, elapsedMs: 2 }],
        cookies: [{ name: 'sid', value }],
        status: 200,
      },
      [value],
    )
    expect(JSON.stringify(response)).not.toContain(value)
    expect(response.body).toContain('REDACTED')
  })
})
