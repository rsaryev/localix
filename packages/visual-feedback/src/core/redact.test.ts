import { describe, expect, test } from 'bun:test'

import { clampCapture, redactSecrets, sanitizeUrl, VF_LIMITS } from './redact'
import type { VfCapture } from '../protocol/index'

function capture(over: Partial<VfCapture> = {}): VfCapture {
  return {
    selector: 'button.cta',
    summary: 'button "Sign up"',
    domPath: 'header.nav > button.cta',
    classes: 'cta',
    role: 'button',
    text: 'Sign up',
    componentPath: 'Sidebar › SignupCta',
    html: '<button aria-label="Sign up" class="cta">',
    computedStyle: 'color: #111',
    rect: { x: 10, y: 20, width: 80, height: 32 },
    kind: 'element',
    ...over,
  }
}

describe('redactSecrets', () => {
  test('redacts provider token shapes', () => {
    expect(redactSecrets('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA z')).toBe('key [redacted] z')
    expect(redactSecrets('openai sk-AAAAAAAAAAAAAAAAAAAAAAAA')).toBe('openai [redacted]')
    expect(redactSecrets('gh ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe('gh [redacted]')
    expect(
      redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'),
    ).toBe('[redacted]')
  })

  test('redacts labeled secrets (token= / api_key: / bearer …)', () => {
    expect(redactSecrets('token=abcdef123456')).toBe('[redacted]')
    expect(redactSecrets('api_key: "abcdef123456"')).toBe('[redacted]')
    expect(redactSecrets('Authorization: Bearer abcdef123456')).toContain('[redacted]')
  })

  test('redacts additional provider shapes and compound labeled keys', () => {
    expect(redactSecrets('glpat-ABCDEFGHIJKLMNOPQRST')).toBe('[redacted]')
    expect(redactSecrets('sk_live_ABCDEFGHIJKLMNOP1234')).toBe('[redacted]')
    expect(redactSecrets('access_token=secretvalue123')).toBe('[redacted]')
  })

  /**
   * Same hole as the server copy (`apps/api/src/lib/secret-redaction.ts`), and it matters
   * MORE here: this payload is built from a picked element's html/text/href and goes
   * straight into the model prompt, so a missed shape is a key handed to the provider.
   * The old `sk-` pattern demanded 20 straight ALNUM after the prefix and so caught only
   * OpenAI's legacy flat key; `sk-proj-`/`sk-svcacct-`/`sk-or-v1-` all slipped past.
   */
  test('redacts sk- keys whose prefix has a segment (openai proj/svcacct, openrouter)', () => {
    expect(redactSecrets('key sk-proj-abcdefghij0123456789abcdefghij0123')).toBe('key [redacted]')
    expect(redactSecrets('key sk-svcacct-abcdefghij0123456789abcdefghij')).toBe('key [redacted]')
    expect(redactSecrets('key sk-or-v1-abcdefghij0123456789abcdefghij01')).toBe('key [redacted]')
  })

  test('does NOT eat ordinary hyphenated text that merely contains sk-', () => {
    // Element text is ordinary prose; over-redaction would blank the very context the
    // capture exists to give the agent.
    for (const clean of [
      'risk-assessment-guidelines-for-the-team-2024',
      'a task-management-system-with-a-long-name-here',
    ])
      expect(redactSecrets(clean)).toBe(clean)
  })

  test('leaves clean text untouched and tolerates undefined', () => {
    expect(redactSecrets('just a normal label')).toBe('just a normal label')
    expect(redactSecrets(undefined)).toBeUndefined()
  })
})

describe('sanitizeUrl', () => {
  test('strips query, hash, and credentials but keeps origin+path', () => {
    expect(sanitizeUrl('https://app.example.com/cb?access_token=secret123#frag')).toBe(
      'https://app.example.com/cb',
    )
    expect(sanitizeUrl('https://user:pass@example.com/x')).toBe('https://example.com/x')
  })

  test('drops dangerous schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined()
    expect(sanitizeUrl('data:text/html,<b>x')).toBeUndefined()
  })

  test('best-effort strips query from relative/unparseable URLs', () => {
    expect(sanitizeUrl('/dashboard?token=abc#x')).toBe('/dashboard')
    expect(sanitizeUrl(undefined)).toBeUndefined()
  })
})

describe('clampCapture', () => {
  test('strips a token-bearing href inside html (URL query removed, token gone)', () => {
    const c = clampCapture(
      capture({ html: '<a href="https://x.com/cb?access_token=ghp_AAAAAAAAAAAAAAAAAAAAAAAA">' }),
    )
    expect(c.html).not.toContain('access_token')
    expect(c.html).not.toContain('ghp_')
    expect(c.html).toContain('https://x.com/cb')
  })

  test('redacts a secret visible in element text', () => {
    const c = clampCapture(capture({ text: 'Your key: ghp_AAAAAAAAAAAAAAAAAAAAAAAA — copy it' }))
    expect(c.text).not.toContain('ghp_')
    expect(c.text).toContain('[redacted]')
  })

  test('caps overlong fields with an ellipsis', () => {
    const c = clampCapture(capture({ text: 'x'.repeat(5000) }))
    expect(c.text!.length).toBeLessThanOrEqual(VF_LIMITS.text)
    expect(c.text!.endsWith('…')).toBe(true)
  })

  test('caps member count and scrubs each member', () => {
    const members = Array.from({ length: 40 }, (_, i) => `a.item-${i}`)
    const c = clampCapture(capture({ kind: 'multi', members }))
    expect(c.members!.length).toBe(VF_LIMITS.members)
  })

  test('preserves structural fields (rect, kind)', () => {
    const c = clampCapture(capture())
    expect(c.rect).toEqual({ x: 10, y: 20, width: 80, height: 32 })
    expect(c.kind).toBe('element')
  })

  test('is idempotent', () => {
    const once = clampCapture(
      capture({ text: 'token=abcdef123456', html: '<a href="/x?t=eyJa.eyJb.sig0000">' }),
    )
    const twice = clampCapture(once)
    expect(twice).toEqual(once)
  })

  test('leaves a clean capture semantically unchanged', () => {
    const c = clampCapture(capture())
    expect(c.selector).toBe('button.cta')
    expect(c.html).toBe('<button aria-label="Sign up" class="cta">')
    expect(c.text).toBe('Sign up')
  })
})
