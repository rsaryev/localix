import { describe, expect, test } from 'bun:test'

import { builtInMiniAppSources, DEFAULT_MINI_APP_CATALOG_URL } from './store-sources'

describe('the catalog every installation reads', () => {
  test('is the Localix marketplace’s published catalog, which Localix vouches for', async () => {
    expect(await builtInMiniAppSources({})).toEqual([
      expect.objectContaining({
        kind: 'catalog',
        url: DEFAULT_MINI_APP_CATALOG_URL,
        vouches: true,
      }),
    ])
  })

  // Its apps update on their own only while its signature holds for a key Localix ships with.
  test('is checked against an Ed25519 key Localix ships with', async () => {
    const [source] = await builtInMiniAppSources({})
    expect(Buffer.from(source?.key ?? '', 'base64')).toHaveLength(32)
  })

  // A local build is unsigned, or signed with its builder's key: the release's key would only
  // make it read as a signature changed, and nothing from it would install.
  test('a marketplace build not yet released stands in for it when one is named', async () => {
    const local = 'file:///work/localix-marketplace/dist/catalog/mini-app-catalog.json'
    expect(await builtInMiniAppSources({ LOCALIX_MINI_APP_CATALOG_URL: local }, 'RELEASE')).toEqual(
      [{ kind: 'catalog', url: local, vouches: true }],
    )
  })

  // A local marketplace build is signed with the builder's own key, not the release's.
  test('the key it is checked against can be named beside it', async () => {
    const local = 'file:///work/localix-marketplace/dist/catalog/mini-app-catalog.json'
    expect(
      await builtInMiniAppSources(
        { LOCALIX_MINI_APP_CATALOG_URL: local, LOCALIX_MINI_APP_CATALOG_KEY: 'LOCAL' },
        'RELEASE',
      ),
    ).toEqual([{ kind: 'catalog', url: local, vouches: true, key: 'LOCAL' }])
  })

  test('the released catalog is checked against the key Localix pins for it', async () => {
    expect(await builtInMiniAppSources({}, 'RELEASE')).toEqual([
      { kind: 'catalog', url: DEFAULT_MINI_APP_CATALOG_URL, vouches: true, key: 'RELEASE' },
    ])
  })
})
