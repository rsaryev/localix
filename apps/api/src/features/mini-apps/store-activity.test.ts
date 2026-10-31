import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
} from '../../testing/mini-app-marketplace'
import { createMiniAppStore } from './store'
import type { MiniAppMarketplaceSource } from './marketplaces'
import type { MiniAppInstallOutcome } from './store-activity'

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

  test('an app a catalog of an earlier release installed is Localix’s own: its marketplace moves it to the new layout', async () => {
    const key = generateKeyPairSync('ed25519').privateKey
    const localix = hostedMiniAppMarketplace([{ name: 'atlas', version: '1.1.0' }], {
      name: 'localix',
      signWith: [key],
    })
    const other = hostedMiniAppMarketplace([{ name: 'atlas', version: '2.0.0' }], {
      name: 'ada',
      url: 'https://ada.test/mini-app-marketplace.json',
    })
    const { store } = storeOver(
      [
        marketplaceSource(localix, { vouches: true, pinned: [publicKeyOf(key)] }),
        marketplaceSource(other),
      ],
      (async (input: string | URL | Request, init?: RequestInit) =>
        (input instanceof Request ? input.url : input.toString()).startsWith('https://ada.test/')
          ? other.fetchImpl(input, init)
          : localix.fetchImpl(input, init)) as typeof fetch,
    )
    // What beta.20 left: the app in its layout then, beside its catalog's record.
    const dir = join(root(), 'home', '.localix', 'mini-apps', 'atlas')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'mini-app.json'), JSON.stringify({ name: 'atlas', version: '1.0.0' }))
    writeFileSync(
      join(dir, '.localix-install.json'),
      JSON.stringify({ kind: 'localix-catalog-install', catalog: 'https://old.test/catalog.json' }),
    )

    expect(await store.updateInstalled()).toEqual(['atlas'])
    await store.settled()
    const { entries } = await store.list()
    expect(entries.map(({ id, installed, update }) => ({ id, installed, update }))).toEqual([
      { id: 'atlas@ada', installed: null, update: false },
      { id: 'atlas@localix', installed: { version: '1.1.0' }, update: false },
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
