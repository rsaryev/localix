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
    'BEARER abcdefgh12345678',
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
    [
      'github fine-grained',
      'key github_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123 end',
      'key [redacted] end',
    ],
    ['aws temporary id', 'id ASIA1234567890ABCDEF end', 'id [redacted] end'],
    [
      'url password',
      'git clone https://bob:hunter2pw@example.com/repo.git',
      'git clone https://bob:[redacted]@example.com/repo.git',
    ],
    ['basic header', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: [redacted]'],
    ['proxy header', 'Proxy-Authorization: Bearer abc.def.ghi', 'Proxy-Authorization: [redacted]'],
    [
      'scheme then a token of letters',
      'Authorization: Bearer abcdefghijklmno',
      'Authorization: [redacted]',
    ],
    ['cookie header', 'Cookie: sid=abc123def456; theme=dark', 'Cookie: [redacted]'],
    [
      'json header',
      '{"Authorization":"Token q9f8d7s6a5","x":1}',
      '{"Authorization":"[redacted]","x":1}',
    ],
    [
      'set-cookie token',
      'Set-Cookie: session=9f8d7s6a5q4w3e2r1t0y; Path=/',
      'Set-Cookie: [redacted]',
    ],
    ['bare bearer token', 'sent Bearer 9f8d7s6a5q4w3e2r1t0y now', 'sent [redacted] now'],
  ])('masks by shape: %s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
    expect(hasSecretShape(input)).toBe(true)
    expect(redactSecrets(expected)).toBe(expected)
  })

  test.each([
    'Bearer of bad news',
    'Bearer authentication is required',
    'Basic information about the account',
    'password: required',
    'Authorization: required',
    'Authorization: failed',
    'Authorization failed for this request',
    'Cookie: none',
    'const authorization = request.headers.get("authorization")',
    'authorization: options.authorization,',
    '// Cookie: name=value pairs',
    'Set-Cookie: session=; Max-Age=0',
    'Set-Cookie: theme=dark; Path=/; Max-Age=31536000',
    'http://localhost:3000@example.com/x',
    'see https://example.com:8080/path and ssh://git@host/repo',
    'https://example.com/a@b',
    'github_pat_short',
    'ASIAN markets and ASIA pacific',
  ])('keeps ordinary text: %s', (input) => {
    expect(hasSecretShape(input)).toBe(false)
    expect(redactSecrets(input)).toBe(input)
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
