import { describe, expect, test } from 'bun:test'

import { setSecretRequestSchema, secretKeySchema } from './contracts'
import { SECRET_KEY_MAX_LENGTH, SECRET_KEY_PATTERN, SECRET_VALUE_MAX_LENGTH } from './limits'

/**
 * The schema must be DERIVED from the limits leaf, never a second copy of them.
 * The settings form validates against the same leaf, so these assertions are the
 * server half of the contract that stops the client green-lighting a key the server
 * will 400 on.
 */
describe('secret limits own the schema', () => {
  test('a key at the cap is accepted; one character over is rejected', () => {
    expect(secretKeySchema.safeParse('A'.repeat(SECRET_KEY_MAX_LENGTH)).success).toBe(true)
    expect(secretKeySchema.safeParse('A'.repeat(SECRET_KEY_MAX_LENGTH + 1)).success).toBe(false)
  })

  test('a value at the cap is accepted; one character over is rejected', () => {
    const at = setSecretRequestSchema.safeParse({
      key: 'K',
      value: 'v'.repeat(SECRET_VALUE_MAX_LENGTH),
    })
    const over = setSecretRequestSchema.safeParse({
      key: 'K',
      value: 'v'.repeat(SECRET_VALUE_MAX_LENGTH + 1),
    })
    expect(at.success).toBe(true)
    expect(over.success).toBe(false)
  })

  test('the key charset rule is the leaf pattern', () => {
    expect(secretKeySchema.safeParse('PROD_DB.PASSWORD-1').success).toBe(true)
    expect(SECRET_KEY_PATTERN.test('PROD_DB.PASSWORD-1')).toBe(true)
    for (const bad of ['has space', 'sla/sh', 'dollar$', '']) {
      expect(secretKeySchema.safeParse(bad).success).toBe(false)
    }
  })

  test('the limits leaf imports nothing — the browser VALUE-imports it', async () => {
    // Any import here (zod above all) would be pulled into the eager UI chunk, which
    // is exactly why these constants do not live in contracts.ts. Match import
    // STATEMENTS, not prose — the module's own comment names zod on purpose.
    const source = await Bun.file(new URL('./limits.ts', import.meta.url)).text()
    expect(source.match(/^\s*import\s/gm) ?? []).toEqual([])
  })
})
