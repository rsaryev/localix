import { describe, expect, test } from 'bun:test'

import { builtInMiniAppSources, DEFAULT_MINI_APP_CATALOG_URL } from './store-sources'

describe('the catalog every installation reads', () => {
  test('is the Localix marketplace’s published catalog, which Localix vouches for', async () => {
    expect(await builtInMiniAppSources({})).toEqual([
      { kind: 'catalog', url: DEFAULT_MINI_APP_CATALOG_URL, vouches: true },
    ])
  })

  test('a marketplace build not yet released stands in for it when one is named', async () => {
    const local = 'file:///work/localix-marketplace/dist/catalog/mini-app-catalog.json'
    expect(await builtInMiniAppSources({ LOCALIX_MINI_APP_CATALOG_URL: local })).toEqual([
      { kind: 'catalog', url: local, vouches: true },
    ])
  })
})
