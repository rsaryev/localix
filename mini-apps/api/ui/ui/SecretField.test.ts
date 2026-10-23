/**
 * WHAT THE PICKER IS ALLOWED TO OFFER, read out of the source.
 *
 * The two claims worth pinning are about the vault's authority over its own items and the boundary
 * between a host vault handle (`secret:KEY`) and an API request template (`${secret:KEY}`). Both
 * fail silently if they regress.
 */

import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { requestSecretReference } from './SecretField'

const FIELD = path.join(import.meta.dir, 'SecretField.tsx')

async function source(): Promise<string> {
  return Bun.file(FIELD).text()
}

describe('the vault decides what is referenceable', () => {
  test('items with no reference are filtered out', async () => {
    // The host capability owns filtering; mini app UI cannot accidentally widen it by consuming raw
    // vault metadata.
    expect(await source()).toContain('miniAppSecrets')
    expect(await source()).toContain('.listReferences()')
    expect(await source()).not.toContain('.list()')
  })

  test('the selected reference comes from the vault', async () => {
    const code = await source()
    expect(code).toContain('reference: secret.reference')
  })

  test('it reads the host vault capability rather than a core client or mini app route', async () => {
    const code = await source()
    expect(code).toContain("from '@localixai/mini-app-sdk/ui/runtime'")
    // No host module at all: the mini app reaches the host only through the SDK and the kit.
    expect(code).not.toMatch(/from ['"]@\//u)
  })
})

describe('vault handle adaptation', () => {
  test('wraps the canonical host handle in API interpolation syntax', () => {
    expect(requestSecretReference('secret:REST_VERIFIED_CREATE_POST_TOKEN')).toBe(
      '${secret:REST_VERIFIED_CREATE_POST_TOKEN}',
    )
  })

  test('does not wrap a reference twice when an older host already returns template syntax', () => {
    expect(requestSecretReference('${secret:EXISTING}')).toBe('${secret:EXISTING}')
  })
})

describe('clearing', () => {
  test('writes an empty string, not the mask', async () => {
    // The mask means "keep what is stored", so clearing with it would be a no-op — the one thing
    // a "clear" must never be.
    expect(await source()).toContain("onChange('')")
    expect(await source()).not.toContain("onChange('••••••')")
  })
})
