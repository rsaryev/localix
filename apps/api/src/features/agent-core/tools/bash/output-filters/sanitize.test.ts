import { describe, test, expect } from 'bun:test'
import { stripAnsi, collapseCarriageReturns } from './sanitize-ansi'
import { redactSecrets } from './redact-secrets'
import { sanitizeModelOutput } from './sanitize'
import { modelFacingOutput } from '../bash-output'

const ESC = '\x1b'

describe('stripAnsi', () => {
  test('CSI SGR color sequences', () => {
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m plain ${ESC}[1;4;38;5;196mstyled${ESC}[m`)).toBe(
      'red plain styled',
    )
  })

  test('CSI non-SGR finals (cursor movement, erase)', () => {
    expect(stripAnsi(`${ESC}[2Kcleared${ESC}[1A${ESC}[10;20Hmoved${ESC}[?25l`)).toBe('clearedmoved')
  })

  test('OSC terminated by BEL and by ST', () => {
    expect(stripAnsi(`${ESC}]0;window title\x07visible`)).toBe('visible')
    expect(stripAnsi(`${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe('link')
  })

  test('unterminated OSC payload does not leak', () => {
    expect(stripAnsi(`before${ESC}]0;cut off mid-title`)).toBe('before')
  })

  test('DCS, SOS, PM, APC payloads removed', () => {
    expect(
      stripAnsi(
        `a${ESC}Pq#0;2;0;0;0sixel${ESC}\\b${ESC}Xsos${ESC}\\c${ESC}^pm${ESC}\\d${ESC}_apc${ESC}\\e`,
      ),
    ).toBe('abcde')
  })

  // The former regex set left both of these as visible text (`31mx`, `1;2`).
  test('8-bit C1 CSI and a CSI cut off mid-stream', () => {
    expect(stripAnsi('\x9b31mx')).toBe('x')
    expect(stripAnsi(`tail${ESC}[1;2`)).toBe('tail')
  })

  test('bare ESC singles and charset designation', () => {
    expect(stripAnsi(`${ESC}(Bx${ESC}=y${ESC}7z${ESC}`)).toBe('xyz')
  })

  test('plain unicode untouched', () => {
    const s = 'παρουσία ✓ 中文 émojis 🎉 └── box'
    expect(stripAnsi(s)).toBe(s)
  })
})

describe('collapseCarriageReturns', () => {
  test('progress line rewritten via \\r keeps only final state', () => {
    expect(collapseCarriageReturns('Progress 10%\rProgress 50%\rProgress 100%\ndone')).toBe(
      'Progress 100%\ndone',
    )
  })

  test('CRLF line endings survive as plain lines', () => {
    expect(collapseCarriageReturns('line one\r\nline two\r\n')).toBe('line one\nline two\n')
  })

  test('no \\r → untouched', () => {
    const s = 'a\nb\nc'
    expect(collapseCarriageReturns(s)).toBe(s)
  })
})

describe('redactSecrets', () => {
  test.each([
    ['AWS access key id', 'key=AKIAIOSFODNN7EXAMPLE ok', 'key=AKIA…[REDACTED:aws-key] ok'],
    [
      'AWS secret in assignment context',
      'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY99',
      'aws_secret_access_key = wJal…[REDACTED:aws-secret]',
    ],
    [
      'GitHub classic token',
      `token ghp_${'A1b2C3d4'.repeat(5)}`,
      'token ghp_…[REDACTED:github-token]',
    ],
    [
      'GitHub fine-grained PAT',
      `github_pat_11ABCDEFG0${'x'.repeat(59)} end`,
      'gith…[REDACTED:github-token] end',
    ],
    [
      'Anthropic key',
      'ANTHROPIC_API_KEY=sk-ant-api03-AbCdEf123456-GhIjKl7890xyz',
      'ANTHROPIC_API_KEY=sk-a…[REDACTED:anthropic-key]',
    ],
    ['OpenAI project key', 'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12', 'sk-p…[REDACTED:openai-key]'],
    ['OpenAI legacy key (40+ tail)', `sk-${'Zx9'.repeat(16)}`, 'sk-Z…[REDACTED:openai-key]'],
    ['Slack token', 'xoxb-1234567890-9876543210-AbCdEfGhIjKl', 'xoxb…[REDACTED:slack-token]'],
    [
      'Bearer header token',
      `Authorization: Bearer ${'tok3n.'.repeat(8)}abcd`,
      'Authorization: Bearer tok3…[REDACTED:bearer-token]',
    ],
  ])('%s redacted with kind + 4-char prefix', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  test('PEM private-key block redacted whole', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEow${'A'.repeat(60)}\n${'B'.repeat(64)}\n-----END RSA PRIVATE KEY-----`
    expect(redactSecrets(`before\n${pem}\nafter`)).toBe('before\n[REDACTED:private-key]\nafter')
  })

  // Precision over recall: these are exactly the shapes an entropy heuristic
  // would eat — the whole reason this redactor is prefix/context-anchored.
  test('legitimate output untouched', () => {
    const legit = [
      'commit 6c700a348deadbeef00112233445566778899aabb', // git SHA
      `base64: ${'QUJDRA=='.repeat(3)}`, // base64 blob under threshold
      'the word secret appears in docs',
      'id: 550e8400-e29b-41d4-a716-446655440000', // UUID
      'sk-short', // sk- but under both guards
      'ghp_tooshort123',
    ].join('\n')
    expect(redactSecrets(legit)).toBe(legit)
  })
})

describe('sanitizeModelOutput', () => {
  test('ANSI-split secret is re-joined and then redacted', () => {
    expect(sanitizeModelOutput(`${ESC}[32mAKIA${ESC}[1mIOSFODNN7EXAMPLE${ESC}[0m`)).toBe(
      'AKIA…[REDACTED:aws-key]',
    )
  })

  test('idempotent: sanitizing twice equals sanitizing once', () => {
    const input = [
      `${ESC}[31mfail${ESC}[0m 10%\rdone 100%`,
      'AKIAIOSFODNN7EXAMPLE',
      'Bearer ' + 'a1B2c3D4'.repeat(6),
      `-----BEGIN PRIVATE KEY-----\n${'C'.repeat(64)}\n-----END PRIVATE KEY-----`,
    ].join('\n')
    const once = sanitizeModelOutput(input)
    expect(sanitizeModelOutput(once)).toBe(once)
    expect(once).not.toBe(input)
  })

  // The pre-stage must fire with NO command context and on tiny outputs —
  // exactly the cases the per-runner registry (command gate + 20-line
  // minimum) is allowed to skip.
  test('runs via modelFacingOutput without command and below MIN_LINES', () => {
    expect(modelFacingOutput('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA…[REDACTED:aws-key]')
    expect(modelFacingOutput(`${ESC}[33mwarn${ESC}[0m`, { command: 'echo warn' })).toBe('warn')
  })
})
