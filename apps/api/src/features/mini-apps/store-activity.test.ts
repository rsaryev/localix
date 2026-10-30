import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
} from '../../testing/mini-app-marketplace'
import {
  createMiniAppStore,
  type MiniAppInstallOutcome,
  type MiniAppMarketplaceSource,
} from './store'

const root = tempDirPerTest('mini-app-store-activity-')
function storeOver(sources: MiniAppMarketplaceSource[], fetchImpl?: typeof fetch) {
  const settled: MiniAppInstallOutcome[][] = []
  const store = createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => sources,
    trust: memoryTrust(),
    onInstalled: async () => {},
    onJobsSettled: (outcomes) => void settled.push(outcomes),
    fetchImpl,
  })
  return { store, settled }
}

describe('the mini app store’s background updates and installs', () => {
  test('the background update installs the newer version of the apps a signed marketplace put here, and says so once', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const marketplace = hostedMiniAppMarketplace([{ name: 'atlas', displayName: 'Atlas' }], {
      signWith: [author],
    })
    const { store, settled } = storeOver(
      [marketplaceSource(marketplace, { vouches: true, pinned: [publicKeyOf(author)] })],
      marketplace.fetchImpl,
    )
    await store.install('atlas')
    await store.settled()
    marketplace.app('atlas').version = '1.1.0'
    expect(await store.updateInstalled()).toEqual(['atlas'])
    await store.settled()
    expect(settled.at(-1)).toEqual([
      expect.objectContaining({ name: 'atlas', label: 'Atlas', kind: 'update', version: '1.1.0' }),
    ])
  })

  test('installs queued together are reported together, a failure with its reason', async () => {
    const marketplace = hostedMiniAppMarketplace([
      { name: 'tasks', displayName: 'Tasks' },
      { name: 'notes', corrupt: true },
    ])
    const { store, settled } = storeOver(
      [marketplaceSource(marketplace, { vouches: true })],
      marketplace.fetchImpl,
    )
    // One whose archive fails its checksum when its turn comes fails; the other installs.
    await store.install('tasks')
    await store.install('notes')
    await store.settled()

    expect(settled).toHaveLength(1)
    const [tasks, notes] = settled[0]!
    expect(tasks).toEqual(
      expect.objectContaining({ name: 'tasks', label: 'Tasks', kind: 'install' }),
    )
    expect(tasks?.error).toBeUndefined()
    expect(notes).toEqual(
      expect.objectContaining({ name: 'notes', label: 'notes', error: expect.any(String) }),
    )
  })
})
