import { describe, expect, test } from 'bun:test'

import { hasSecretShape, redactSecrets } from './secret-shapes'

describe('shared secret shapes', () => {
  test.each([
    'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA',
    'sk-proj-abcdefghij0123456789abcdefghij0123',
    'ghp_AAAAAAAAAAAAAAAAAAAA',
    'xoxb-1234567890',
    'AKIA1234567890ABCDEF',
    '-----BEGIN PRIVATE KEY-----\nprivate bytes\n-----END PRIVATE KEY-----',
    `AIza${'a'.repeat(35)}`,
    `GOCSPX-${'a'.repeat(20)}`,
    `glpat-${'a'.repeat(20)}`,
    'rk_test_1234567890',
    'eyJabcdefgh.abcdefgh.abcdefgh',
    'BEARER abcdefghijkl',
    'client_secret: "abcdefgh"',
  ])('keeps detection and replacement consistent for %s', (secret) => {
    const input = `before ${secret} after`
    // Detection must remain stable across repeated calls and interleaved redaction:
    // global regular expressions retain lastIndex after a successful test.
    for (let iteration = 0; iteration < 3; iteration++) {
      expect(hasSecretShape(input)).toBe(true)
      expect(hasSecretShape(input)).toBe(true)
      expect(redactSecrets(input)).toBe('before [redacted] after')
      expect(hasSecretShape('ordinary text')).toBe(false)
    }
  })

  test.each([
    '',
    'token_count: 1234',
    'risk-assessment-guidelines-for-the-team-2024',
    'ghp_short',
    'token=short',
    '{"content":"ordinary visible text"}',
  ])('preserves clean text: %s', (input) => {
    expect(hasSecretShape(input)).toBe(false)
    expect(redactSecrets(input)).toBe(input)
  })
})
