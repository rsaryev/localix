import { describe, expect, test } from 'bun:test'

import { createVaultResourceProvider, vaultItemResourceUri } from './resource-provider'
import type { SecretMeta } from './contracts'

const item: SecretMeta = {
  id: 'item-1',
  key: 'PROD_API_KEY',
  label: 'Production API',
  description: 'Used by deployment agents',
  type: 'api_key',
  source: 'user',
  backend: 'local-aes',
  version: 4,
  tags: ['production', 'deploy'],
  reference: 'secret:PROD_API_KEY',
  createdAt: 1,
  updatedAt: 2,
}

describe('Vault @resource provider', () => {
  test('lists searchable, linkable metadata-only Vault nodes', async () => {
    const provider = createVaultResourceProvider({ listItems: async () => [item] })
    expect(provider.provider).toBe('vault')
    expect(await provider.listChildren('u', null, 'deployment')).toEqual([
      expect.objectContaining({
        uri: 'localix://resource/vault/items/PROD_API_KEY',
        label: 'Production API',
        detail: 'api_key · PROD_API_KEY',
        hasChildren: false,
      }),
    ])
    expect(await provider.listChildren('u', null, 'wallet')).toEqual([])
  })

  test('expands to metadata and a reference without any value field', async () => {
    const provider = createVaultResourceProvider({ listItems: async () => [item] })
    const expanded = await provider.expand('u', vaultItemResourceUri(item.key))
    expect(expanded.ok).toBe(true)
    expect(expanded.content).toContain('"title": "Production API"')
    expect(expanded.content).toContain('"reference": "secret:PROD_API_KEY"')
    expect(expanded.content).toContain('"modelCanReadValue": false')
    expect(expanded.content).not.toContain('sk-sentinel')
  })
})
