import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
  servingAll,
} from '../../testing/mini-app-marketplace'
import { createMiniAppStore } from './store'
import type { MiniAppMarketplaceSource } from './store-offers'

const root = tempDirPerTest('mini-app-store-')
const LOCALIX_URL = 'https://localix.example.test/m/mini-app-marketplace.json'
const ADA_URL = 'https://ada.example.test/m/mini-app-marketplace.json'

function setup(extra: Partial<MiniAppMarketplaceSource> = {}) {
  const localix = hostedMiniAppMarketplace(
    [{ name: 'atlas', displayName: 'Atlas', category: 'games' }, { name: 'notes' }],
    { url: LOCALIX_URL, name: 'localix', owner: 'Localix' },
  )
  const ada = hostedMiniAppMarketplace([{ name: 'notes', version: '2.0.0' }], {
    url: ADA_URL,
    name: 'ada',
    owner: 'Ada',
  })
  const home = join(root(), 'home')
  const changes: string[] = []
  let pokes = 0
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [
      marketplaceSource(localix, { vouches: true, builtIn: true, ...extra }),
      marketplaceSource(ada),
    ],
    trust: memoryTrust(),
    onInstalled: async (name) => void changes.push(name),
    fetchImpl: servingAll(localix, ada),
  })
  store.subscribe(() => pokes++)
  const appDir = (name: string) => join(home, '.localix', 'mini-apps', name)
  return { localix, ada, home, store, changes, appDir, pokes: () => pokes }
}

describe('the mini app store', () => {
  test('lists every app under its identity, with its publisher, and nothing as installed yet', async () => {
    const { store } = setup()

    const { entries } = await store.list()
    expect(entries.map((entry) => entry.id)).toEqual([
      'atlas@localix',
      'notes@ada',
      'notes@localix',
    ])
    expect(entries[0]).toMatchObject({
      name: 'atlas',
      marketplace: 'localix',
      displayName: 'Atlas',
      category: 'games',
      version: '1.0.0',
      publisher: { name: 'Localix', verified: true },
      installed: null,
      update: false,
    })
    expect(entries[1]!.publisher).toEqual({ name: 'Ada', verified: false })
  })

  test('installing one goes through its phases, announces it, and lists it as installed', async () => {
    const { appDir, store, changes, pokes } = setup()

    await store.install('atlas@localix')
    await store.settled()

    expect(changes).toEqual(['atlas'])
    expect(pokes()).toBeGreaterThan(1)
    expect(
      JSON.parse(await fs.readFile(join(appDir('atlas'), '.localix-install.json'), 'utf8')),
    ).toMatchObject({
      kind: 'localix-marketplace-install',
      marketplace: 'localix',
      url: LOCALIX_URL,
    })
    const { entries } = await store.list()
    expect(entries.find((entry) => entry.id === 'atlas@localix')).toMatchObject({
      installed: { version: '1.0.0' },
      job: { phase: 'done' },
    })
    expect(entries.find((entry) => entry.id === 'notes@localix')?.installed).toBeNull()
  })

  test('two installs of one app asked at once run one job', async () => {
    const { store, changes } = setup()
    await Promise.all([store.install('atlas@localix'), store.install('atlas@localix')])
    await store.settled()
    expect(changes).toEqual(['atlas'])
  })

  test('a name alone is the app installed by it, else the first marketplace’s', async () => {
    const { store } = setup()
    expect((await store.detail('notes')).entry.id).toBe('notes@localix')
    await store.install('notes@ada', { acceptUnverified: true })
    await store.settled()
    expect((await store.detail('notes')).entry.id).toBe('notes@ada')
  })

  // One folder per name: the same name from another marketplace is another publisher's app.
  test('an app is not installed over another app by its name', async () => {
    const { store } = setup()
    await store.install('notes@localix')
    await store.settled()

    const entries = (await store.list()).entries
    expect(entries.find((entry) => entry.id === 'notes@ada')).toMatchObject({
      installed: null,
      update: false,
    })
    await expect(store.install('notes@ada', { acceptUnverified: true })).rejects.toThrow(
      '"notes" from localix is installed; remove it to install the one from ada',
    )
  })

  test('a newer version from its own marketplace is an update; another marketplace’s is not', async () => {
    const { localix, store } = setup()
    await store.install('atlas@localix')
    await store.install('notes@localix')
    await store.settled()
    localix.app('atlas').version = '1.1.0'
    // The marketplace is read again once its hold has passed; an update check reads it afresh.
    await store.refresh()

    const { entries } = await store.list()
    expect(entries.find((entry) => entry.id === 'atlas@localix')).toMatchObject({
      installed: { version: '1.0.0' },
      version: '1.1.0',
      update: true,
    })
    // ada offers notes 2.0.0, but this notes is Localix's.
    expect(entries.find((entry) => entry.id === 'notes@ada')?.update).toBe(false)
  })

  test('an app the person made is theirs: no marketplace offers it an update or a replacement', async () => {
    const { appDir, store } = setup()
    writeTree(appDir('atlas'), {
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'atlas', version: '2.0.0' }),
      '.localix-install.json': JSON.stringify({
        kind: 'localix-local-install',
        source: '/src/atlas',
        version: '2.0.0',
      }),
    })

    const atlas = (await store.list()).entries.find((entry) => entry.id === 'atlas@localix')
    expect(atlas).toMatchObject({ installed: null, update: false })
    expect(await store.updateInstalled()).toEqual([])
    await expect(store.install('atlas@localix')).rejects.toThrow(
      /of yours is already called "atlas"/,
    )
  })

  test('a build Localix blocks is not installed, from whichever marketplace', async () => {
    const { localix, ada, store } = setup()
    const { sha256 } = await ada.archiveOf('notes')
    localix.release.blockedArchives = [{ sha256, reason: 'It sends notes away.' }]
    await store.refresh()
    await expect(store.install('notes@ada', { acceptUnverified: true })).rejects.toThrow(
      'Localix blocks this build of "notes": It sends notes away.',
    )
  })

  test('nothing installs from a marketplace whose signature changed', async () => {
    const shipped = generateKeyPairSync('ed25519').privateKey
    const { localix, store } = setup({ pinned: [publicKeyOf(shipped)] })
    localix.release.signWith = [generateKeyPairSync('ed25519').privateKey]
    await expect(store.install('atlas@localix')).rejects.toThrow(/signature changed/)
  })

  test('an app no marketplace offers is refused, saying which', async () => {
    const { store } = setup()
    await expect(store.install('ghost')).rejects.toThrow(/ghost/)
    await expect(store.install('atlas@ada')).rejects.toThrow(/atlas@ada/)
  })
})
