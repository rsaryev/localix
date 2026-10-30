import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
  servingAll,
} from '../../testing/mini-app-marketplace'
import { createMiniAppStore } from './store'

// Localix Community is a list: each mini app in it links to its author's own marketplace, which
// says what the app is and signs it (or not) with the author's own key. Localix vouches for none
// of it; every app in it is `<name>@localix-community`, so it never takes a Localix app's place.

const root = tempDirPerTest('mini-app-store-community-')
const LIST = 'https://community.example.test/mini-app-marketplace.json'
const ADA = 'https://github.com/ada/habits/releases/latest/download/mini-app-marketplace.json'
const BOB = 'https://bob.example.test/mini-app-marketplace.json'

function setup() {
  const author = generateKeyPairSync('ed25519').privateKey
  const list = hostedMiniAppMarketplace(
    [{ name: 'habits', link: { source: 'github', repo: 'ada/habits' }, description: 'Habits' }],
    { url: LIST, name: 'localix-community', owner: 'Localix Community' },
  )
  const ada = hostedMiniAppMarketplace([{ name: 'habits', version: '1.0.0' }], {
    url: ADA,
    name: 'ada',
    owner: 'Ada',
    signWith: [author],
  })
  // A marketplace the person added offers its own "habits", newer.
  const bob = hostedMiniAppMarketplace([{ name: 'habits', version: '2.0.0' }], {
    url: BOB,
    name: 'bob',
    owner: 'Bob',
  })
  const home = join(root(), 'home')
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [marketplaceSource(list, { builtIn: true }), marketplaceSource(bob)],
    trust: memoryTrust(),
    onInstalled: async () => {},
    fetchImpl: servingAll(list, ada, bob),
  })
  return { store, ada, home }
}

describe('a mini app Localix Community links to', () => {
  test('installs from its author’s marketplace after a yes, under the list’s identity', async () => {
    const { store, home } = setup()
    await expect(store.install('habits@localix-community')).rejects.toThrow('unverified publisher')
    await store.install('habits@localix-community', { acceptUnverified: true })
    await store.settled()
    const record = JSON.parse(
      await fs.readFile(
        join(home, '.localix', 'mini-apps', 'habits', '.localix-install.json'),
        'utf8',
      ),
    )
    expect(record).toMatchObject({ marketplace: 'localix-community', url: ADA, version: '1.0.0' })
    expect(
      (await store.list()).entries.find((e) => e.id === 'habits@localix-community'),
    ).toMatchObject({ installed: { version: '1.0.0' }, signature: 'signed' })
  })

  test('another marketplace’s app by its name never updates it', async () => {
    const { store } = setup()
    await store.install('habits@localix-community', { acceptUnverified: true })
    await store.settled()
    expect((await store.list()).entries.find((e) => e.id === 'habits@bob')).toMatchObject({
      version: '2.0.0',
      installed: null,
      update: false,
    })
    expect(await store.updateInstalled()).toEqual([])
  })

  test('its author’s marketplace signed with another key installs nothing', async () => {
    const { store, ada } = setup()
    await store.list()
    ada.release.signWith = [generateKeyPairSync('ed25519').privateKey]
    await store.refresh()
    expect(
      (await store.list()).entries.find((e) => e.id === 'habits@localix-community')?.signature,
    ).toBe('mismatch')
    await expect(
      store.install('habits@localix-community', { acceptUnverified: true }),
    ).rejects.toThrow('signature changed')
  })
})
