import { describe, expect, test } from 'bun:test'

import { createSecretsSearchProvider } from './search-provider'
import { searchHitsOf } from '@localixai/plugin-sdk/backend'

describe('Vault search provider', () => {
  test('mints distinct value-free deep links to the Vault workspace', async () => {
    const provider = createSecretsSearchProvider({
      listItems: async () => [
        { key: 'A_KEY', label: 'Alpha credential', type: 'api_key' },
        { key: 'B_KEY', label: 'Beta credential', type: 'database' },
      ],
    })
    const hits = searchHitsOf(await provider.search('u', { text: 'credential' }))
    expect(hits.map((hit) => hit.id)).toEqual([
      'localix://resource/vault/items/A_KEY',
      'localix://resource/vault/items/B_KEY',
    ])
    expect(JSON.stringify(hits)).not.toContain('secret-value')
  })
})
