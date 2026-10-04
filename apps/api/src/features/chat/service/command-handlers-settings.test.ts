import { describe, expect, test } from 'bun:test'

import { uniqueCatalogModelProvider } from './command-handlers-settings'

const providers = [{ id: 'provider-a' }, { id: 'provider-b' }]

describe('uniqueCatalogModelProvider', () => {
  test('recovers a deleted connection only when the stored model has one owner', () => {
    expect(
      uniqueCatalogModelProvider(
        providers,
        [{ id: 'provider-a/unique', providerId: 'provider-a' }],
        'provider-a/unique',
      ),
    ).toBe('provider-a')
  })

  test('fails closed for an ambiguous or unknown bare model id', () => {
    const models = [
      { id: 'shared', providerId: 'provider-a' },
      { id: 'shared', providerId: 'provider-b' },
    ]
    expect(uniqueCatalogModelProvider(providers, models, 'shared')).toBeNull()
    expect(uniqueCatalogModelProvider(providers, models, 'missing')).toBeNull()
  })
})
