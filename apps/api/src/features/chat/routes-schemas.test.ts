import { describe, expect, test } from 'bun:test'
import { replaceContentRequestSchema } from './routes-schemas'

describe('replaceContentRequestSchema', () => {
  test('preserves ignored-file scope so replace can match the preceding search', () => {
    expect(
      replaceContentRequestSchema.parse({
        q: 'needle',
        replacement: 'value',
        includeIgnored: true,
      }),
    ).toEqual({
      q: 'needle',
      replacement: 'value',
      includeIgnored: true,
    })
  })
})
