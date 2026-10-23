import { describe, expect, test } from 'bun:test'

import { updateSecretMetadataRequestSchema } from './contracts'
import { vaultActionSchema } from './vault-tool-schema'

// The route and the agent tool accept the same value-free metadata patch.
describe('a Vault metadata patch', () => {
  test('the route needs at least one metadata field', () => {
    expect(updateSecretMetadataRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false)
    const ok = updateSecretMetadataRequestSchema.safeParse({ expectedVersion: 1, tags: [' a '] })
    expect(ok.success && ok.data).toEqual({ expectedVersion: 1, tags: ['a'] })
    expect(
      updateSecretMetadataRequestSchema.safeParse({ expectedVersion: 1, title: 'x', extra: 1 })
        .success,
    ).toBe(false)
  })

  test('the agent tool needs at least one metadata field', () => {
    const base = { action: 'update' as const, key: 'OPENAI_KEY', expected_version: 3 }
    expect(vaultActionSchema.safeParse(base).success).toBe(false)
    const ok = vaultActionSchema.safeParse({ ...base, description: ' d ' })
    expect(ok.success && ok.data).toEqual({ ...base, description: 'd' })
  })
})
