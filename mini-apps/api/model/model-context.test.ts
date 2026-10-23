import { describe, expect, test } from 'bun:test'
import { hasSecretShape } from '@localixai/mini-app-sdk/secret-shapes'
import { formatBodyForModel, redactModelSecrets } from './model-context'

describe('formatBodyForModel', () => {
  test('keeps ordinary body/content fields without the quoted-key false positive', () => {
    const output = formatBodyForModel(
      '{"title":"API test","body":"ordinary response text","content":"visible"}',
      'application/json',
    )
    expect(output).toContain('body: "ordinary response text"')
    expect(output).toContain('content: "visible"')
    expect(output).not.toContain('"body":')
    expect(output).not.toContain('"content":')
  })

  test('masks credential-bearing JSON fields but keeps the response shape', () => {
    const output = formatBodyForModel(
      '{"user":"ada","access_token":"top-secret-value","nested":{"password":"hunter22"}}',
      'application/json',
    )
    expect(output).toContain('user: "ada"')
    expect(output).toContain('access_token: "[redacted]"')
    expect(output).toContain('password: "[redacted]"')
    expect(output).not.toContain('top-secret-value')
    expect(output).not.toContain('hunter22')
  })

  test('preserves arrays, nulls and scalar values', () => {
    const output = formatBodyForModel('[{"id":1},null,true]', 'application/json')
    expect(output).toContain('id: 1')
    expect(output).toContain('null')
    expect(output).toContain('true')
  })

  test('scrubs strong credential shapes in text payloads', () => {
    const token = `ghp_${'a'.repeat(24)}`
    expect(redactModelSecrets(`token ${token}`)).toBe('token [redacted]')
    expect(formatBodyForModel(`Authorization: Bearer ${'a'.repeat(20)}`, 'text/plain')).toBe(
      'Authorization: [redacted]',
    )
  })

  test('masks every shape the host admission boundary would reject', () => {
    // One shared list: a shape the host rejects is never left in a body the view sends on.
    const samples = [
      `sk-ant-${'a'.repeat(24)}`,
      `GOCSPX-${'b'.repeat(24)}`,
      `glpat-${'c'.repeat(24)}`,
      `AIza${'d'.repeat(35)}`,
      'AKIAABCDEFGHIJKLMNOP',
    ]
    for (const sample of samples) {
      expect(hasSecretShape(sample)).toBe(true)
      expect(hasSecretShape(redactModelSecrets(`value ${sample}`))).toBe(false)
    }
  })
})
