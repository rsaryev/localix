import { describe, it, expect } from 'bun:test'
import { redactSecrets as redactSecretShapes } from '@localixai/visual-feedback/secret-shapes'

import { createLogger } from './logger'
import {
  MAX_LOG_COLLECTION_ENTRIES,
  MAX_LOG_STRING_LENGTH,
  hasSecretShape,
  redactDeep,
  redactSecrets,
  sanitizeLogString,
} from './secret-redaction'

describe('redactSecrets', () => {
  it('keeps serialized message privacy specific to logs', () => {
    const input = '{"content":"ordinary visible text", "key":"ghp_AAAAAAAAAAAAAAAAAAAA"}'
    expect(redactSecretShapes(input)).toBe(
      '{"content":"ordinary visible text", "key":"[redacted]"}',
    )
    expect(redactSecrets(input)).toBe('{[redacted], "key":"[redacted]"}')
    for (let iteration = 0; iteration < 3; iteration++) {
      expect(hasSecretShape('{"content":"ordinary visible text"}')).toBe(true)
      expect(hasSecretShape('ghp_AAAAAAAAAAAAAAAAAAAA')).toBe(true)
      expect(hasSecretShape('ordinary text')).toBe(false)
    }
  })

  it('redacts provider token shapes', () => {
    expect(redactSecrets('use sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA now')).toBe(
      'use [redacted] now',
    )
    expect(redactSecrets('openai sk-AAAAAAAAAAAAAAAAAAAAAAAA')).toBe('openai [redacted]')
    expect(redactSecrets('gh ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('gh [redacted]')
    expect(redactSecrets('Authorization: Bearer abcdefghijklmno')).toContain('[redacted]')
  })

  it('redacts compound labeled keys (access_token / client_secret)', () => {
    expect(redactSecrets('access_token=secretvalue123')).toBe('[redacted]')
    expect(redactSecrets('client_secret: "secretvalue123"')).toBe('[redacted]')
  })

  it('redacts serialized message bodies without requiring token-shaped text', () => {
    const serialized = JSON.stringify({
      role: 'user',
      content: `ordinary user's "private" request`,
    })
    expect(redactSecrets(`provider error: ${serialized}`)).not.toContain('ordinary private request')
    expect(redactSecrets(`provider error: ${serialized}`)).not.toContain(`ordinary user's`)
    expect(redactSecrets(`provider error: ${serialized}`)).toContain('[redacted]')
    expect(redactSecrets(`provider error: { 'input': 'user said "private"' }`)).not.toContain(
      'user said',
    )
  })

  it('redacts additional provider key shapes (google/gitlab/stripe/pem)', () => {
    expect(redactSecrets('key AIzaSyA1234567890abcdefghijklmnopqrstuvw')).toContain('[redacted]')
    expect(redactSecrets('glpat-ABCDEFGHIJKLMNOPQRST')).toBe('[redacted]')
    expect(redactSecrets('sk_live_ABCDEFGHIJKLMNOP1234')).toBe('[redacted]')
    expect(
      redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEvQ==\n-----END RSA PRIVATE KEY-----'),
    ).toBe('[redacted]')
  })

  it('redacts sk- keys whose prefix has a segment (openai proj/svcacct, openrouter)', () => {
    expect(redactSecrets('key sk-proj-abcdefghij0123456789abcdefghij0123')).toBe('key [redacted]')
    expect(redactSecrets('key sk-svcacct-abcdefghij0123456789abcdefghij')).toBe('key [redacted]')
    expect(redactSecrets('key sk-or-v1-abcdefghij0123456789abcdefghij01')).toBe('key [redacted]')
  })

  it('does NOT eat ordinary hyphenated prose that merely ends in sk-', () => {
    // The other direction, and the reason the pattern is anchored at `\b` with alnum
    // ends: over-redaction is not free — a scrubbed log line is a lost log line.
    for (const clean of [
      'risk-assessment-guidelines-for-the-team-2024',
      'a task-management-system-with-a-long-name-here',
      'disk-usage-report-generated-yesterday-again',
    ])
      expect(redactSecrets(clean)).toBe(clean)
  })

  it('leaves ordinary text and token_count-style keys untouched', () => {
    expect(redactSecrets('just a normal log line')).toBe('just a normal log line')
    expect(redactSecrets('token_count: 1234')).toBe('token_count: 1234')
  })
})

describe('redactDeep', () => {
  it('scrubs strings nested in arrays and plain objects', () => {
    const out = redactDeep({
      a: 'sk-AAAAAAAAAAAAAAAAAAAAAAAA',
      b: ['x', 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    }) as {
      a: string
      b: string[]
    }
    expect(out.a).toBe('[redacted]')
    expect(out.b[1]).toBe('[redacted]')
  })

  it('passes class instances (Error) through untouched', () => {
    const err = new Error('boom')
    expect(redactDeep(err)).toBe(err)
  })

  it('drops message bodies, opaque credentials, and terminal input by field semantics', () => {
    expect(
      redactDeep({
        prompt: 'ordinary private sentence',
        content: 'message body',
        token: 'short-opaque-oauth-value',
        accessToken: 'opaque-value-with-no-token-shape',
        frame: { t: 'input', data: 'typed terminal password' },
        diagnostic: 'safe explanation',
      }),
    ).toEqual({
      prompt: '[redacted]',
      content: '[redacted]',
      token: '[redacted]',
      accessToken: '[redacted]',
      frame: { t: 'input', data: '[redacted]' },
      diagnostic: 'safe explanation',
    })
  })

  it('replaces deep subtrees instead of returning them uninspected', () => {
    const out = redactDeep({
      a: { b: { c: { d: { e: { secret: 'opaque-private-value' } } } } },
    })
    expect(JSON.stringify(out)).not.toContain('opaque-private-value')
    expect(JSON.stringify(out)).toContain('[truncated]')
  })

  it('bounds arrays and objects before serialization', () => {
    const oversizedArray = Array.from(
      { length: MAX_LOG_COLLECTION_ENTRIES + 50 },
      (_, index) => index,
    )
    const oversizedObject = Object.fromEntries(
      Array.from({ length: MAX_LOG_COLLECTION_ENTRIES + 50 }, (_, index) => [
        `field${index}`,
        index,
      ]),
    )
    const arrayOut = redactDeep(oversizedArray) as unknown[]
    const objectOut = redactDeep(oversizedObject) as Record<string, unknown>
    expect(arrayOut).toHaveLength(MAX_LOG_COLLECTION_ENTRIES + 1)
    expect(arrayOut.at(-1)).toBe('[truncated]')
    expect(Object.keys(objectOut)).toHaveLength(MAX_LOG_COLLECTION_ENTRIES + 1)
    expect(objectOut['…']).toBe('[truncated]')
  })
})

describe('sanitizeLogString', () => {
  it('bounds individual log fields while preserving useful prefix and tail context', () => {
    const value = `begin:${'x'.repeat(MAX_LOG_STRING_LENGTH * 2)}:end`
    const out = sanitizeLogString(value)
    expect(out.length).toBe(MAX_LOG_STRING_LENGTH)
    expect(out.startsWith('begin:')).toBe(true)
    expect(out.endsWith(':end')).toBe(true)
    expect(out).toContain('[truncated]')
  })
})

describe('createLogger redaction', () => {
  it('scrubs secrets from the message and metadata before writing', () => {
    let out = ''
    const log = createLogger('info', {
      write: (s: string) => {
        out += s
      },
    })
    log.info(
      {
        token: 'sk-AAAAAAAAAAAAAAAAAAAAAAAA',
        nested: { note: 'access_token=secretvalue123' },
      },
      'leak sk-BBBBBBBBBBBBBBBBBBBBBBBB here',
    )
    expect(out).not.toContain('sk-AAAA')
    expect(out).not.toContain('sk-BBBB')
    expect(out).not.toContain('secretvalue123')
    expect(out).toContain('[redacted]')
  })

  it('redacts secrets in an Error message and stack', () => {
    let out = ''
    const log = createLogger('info', {
      write: (s: string) => {
        out += s
      },
    })
    log.error(new Error('auth failed: sk-CCCCCCCCCCCCCCCCCCCCCCCC'), 'op failed')
    expect(out).not.toContain('sk-CCCC')
    expect(out).toContain('[redacted]')
  })
})
