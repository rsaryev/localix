import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
} from '../../testing/mini-app-marketplace'
import { createMiniAppStore } from './store'

const root = tempDirPerTest('mini-app-store-recommended-')

/** A store over one marketplace whose one app, `habits`, says to install it by default. */
function storeOver(vouches: boolean) {
  const marketplace = hostedMiniAppMarketplace([{ name: 'habits', installByDefault: true }])
  return createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => [marketplaceSource(marketplace, { vouches })],
    trust: memoryTrust(),
    onInstalled: async () => {},
    fetchImpl: marketplace.fetchImpl,
  })
}

describe('mini apps installed by default', () => {
  test('a marketplace Localix vouches for marks the apps it installs by default', async () => {
    expect((await storeOver(true).list()).entries[0]).toMatchObject({
      name: 'habits',
      installByDefault: true,
    })
  })

  test('a marketplace someone added cannot install itself', async () => {
    expect((await storeOver(false).list()).entries[0]?.installByDefault).toBeUndefined()
  })
})
