import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  hostedMiniAppMarketplace,
  marketplaceSource,
  memoryTrust,
  type MarketplaceEntry,
} from '../../testing/mini-app-marketplace'
import { createMiniAppStore, type MiniAppJob } from './store'

const root = tempDirPerTest('mini-app-store-marketplace-')
/** A released marketplace offering these apps, Localix's unless said. */
const hostedMarketplace = (apps: MarketplaceEntry[], signWith?: KeyObject) =>
  hostedMiniAppMarketplace(apps, {
    name: 'localix',
    owner: 'Localix',
    ...(signWith ? { signWith: [signWith] } : {}),
  })

function setup(
  marketplace: ReturnType<typeof hostedMarketplace>,
  vouches = true,
  opts: {
    /** The keys Localix ships for it. */
    pinned?: KeyObject
    autoUpdateOff?: () => Promise<ReadonlySet<string>>
  } = {},
) {
  const home = join(root(), 'home')
  const installed: { name: string; fresh: boolean }[] = []
  const phases: MiniAppJob[] = []
  const trust = memoryTrust()
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [
      marketplaceSource(marketplace, {
        vouches,
        builtIn: vouches,
        ...(opts.pinned ? { pinned: [publicKeyOf(opts.pinned)] } : {}),
      }),
    ],
    trust,
    onInstalled: async (name, { fresh }) => void installed.push({ name, fresh }),
    fetchImpl: marketplace.fetchImpl,
    ...(opts.autoUpdateOff ? { autoUpdateOff: opts.autoUpdateOff } : {}),
  })
  store.subscribe(() => {
    const job = store.jobs().get('atlas')
    if (job) phases.push({ ...job })
  })
  const appDir = join(home, '.localix', 'mini-apps', 'atlas')
  return { home, store, installed, phases, appDir, trust }
}

describe('the mini app store, from a released marketplace', () => {
  test('downloads the archive with progress, checks it and installs it', async () => {
    const { store, installed, phases, appDir } = setup(
      hostedMarketplace([{ name: 'atlas', version: '1.0.0' }]),
    )
    expect((await store.list()).entries[0]).toMatchObject({
      name: 'atlas',
      version: '1.0.0',
      publisher: { name: 'Localix', verified: true },
      installed: null,
    })

    await store.install('atlas')
    await store.settled()

    expect(phases.map((job) => job.phase)).toEqual(
      expect.arrayContaining(['queued', 'downloading', 'installing', 'done']),
    )
    expect(phases.find((job) => job.phase === 'downloading')?.total).toBeGreaterThan(0)
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# atlas 1.0.0')
    expect(installed).toEqual([{ name: 'atlas', fresh: true }])
    expect((await store.list()).entries[0]?.installed).toEqual({ version: '1.0.0' })
  })

  test('an archive that fails its checksum installs nothing and keeps the version before', async () => {
    const first = setup(hostedMarketplace([{ name: 'atlas', version: '1.0.0' }]))
    await first.store.install('atlas')
    await first.store.settled()

    const { store, appDir } = setup(
      hostedMarketplace([{ name: 'atlas', version: '1.1.0', corrupt: true }]),
    )
    await store.install('atlas')
    await store.settled()

    expect(store.jobs().get('atlas')).toMatchObject({ phase: 'failed' })
    expect(store.jobs().get('atlas')?.error).toContain('checksum')
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# atlas 1.0.0')
  })

  test('a publisher the source does not vouch for is unverified and waits for a yes', async () => {
    const { store, installed } = setup(
      hostedMarketplace([{ name: 'atlas', version: '1.0.0' }]),
      false,
    )
    expect((await store.list()).entries[0]?.publisher.verified).toBe(false)
    await expect(store.install('atlas')).rejects.toThrow(/unverified/i)
    await store.install('atlas', { acceptUnverified: true })
    await store.settled()
    expect(installed.map(({ name }) => name)).toEqual(['atlas'])
  })

  test('an app built for a newer Localix is listed as incompatible and not installed', async () => {
    const { store } = setup(
      hostedMarketplace([{ name: 'atlas', version: '1.0.0', apiVersion: 99 }]),
    )
    expect((await store.list()).entries[0]?.incompatible).toBe(true)
    await expect(store.install('atlas')).rejects.toThrow(/newer Localix/)
  })

  test('updates are installed for what the marketplace put there, never for a folder of yours', async () => {
    const before = setup(hostedMarketplace([{ name: 'atlas', version: '1.0.0' }]))
    await before.store.install('atlas')
    await before.store.settled()
    const mine = join(before.home, '.localix', 'mini-apps', 'notes')
    await fs.mkdir(mine, { recursive: true })
    writeTree(mine, {
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'notes', version: '0.1.0' }),
    })

    const author = generateKeyPairSync('ed25519').privateKey
    const { store, installed, appDir } = setup(
      hostedMarketplace(
        [
          { name: 'atlas', version: '1.1.0' },
          { name: 'notes', version: '2.0.0' },
        ],
        author,
      ),
      true,
      { pinned: author },
    )
    expect(await store.updateInstalled()).toEqual(['atlas'])
    await store.settled()
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# atlas 1.1.0')
    expect(installed).toEqual([{ name: 'atlas', fresh: false }])
    await expect(store.install('notes')).rejects.toThrow(/yours/)
  })

  test('a marketplace that cannot be reached is a problem of the listing, not an empty store', async () => {
    const down = {
      ...hostedMarketplace([]),
      fetchImpl: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
    }
    const { store } = setup(down)
    const listing = await store.list()
    expect(listing.entries).toEqual([])
    expect(listing.problems[0]).toContain('503')
  })

  test('updates come on their own only from a marketplace signed with a key kept for it', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const signed = hostedMarketplace([{ name: 'atlas', version: '1.0.0' }], author)
    const { store } = setup(signed, true, { pinned: author })
    await store.install('atlas')
    await store.settled()
    expect((await store.list()).entries[0]?.signature).toBe('signed')

    signed.app('atlas').version = '1.1.0'
    expect(await store.updateInstalled()).toEqual(['atlas'])
  })

  test('an app from an unsigned marketplace is offered its update but never takes it alone', async () => {
    const unsigned = hostedMarketplace([{ name: 'atlas', version: '1.0.0' }])
    const { store } = setup(unsigned)
    await store.install('atlas')
    await store.settled()

    unsigned.app('atlas').version = '1.1.0'
    expect(await store.updateInstalled()).toEqual([])
    await store.refresh()
    expect((await store.list()).entries[0]).toMatchObject({ signature: 'unsigned', update: true })
  })

  test('an app the person keeps from updating on its own waits for them', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const signed = hostedMarketplace([{ name: 'atlas', version: '1.0.0' }], author)
    const { store } = setup(signed, true, {
      pinned: author,
      autoUpdateOff: async () => new Set(['atlas']),
    })
    await store.install('atlas')
    await store.settled()

    signed.app('atlas').version = '1.1.0'
    expect(await store.updateInstalled()).toEqual([])
  })

  test('a marketplace signed with another key than the ones kept for it installs nothing', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const impostor = generateKeyPairSync('ed25519').privateKey
    const swapped = hostedMarketplace([{ name: 'atlas', version: '1.0.0' }], impostor)
    const { store, installed } = setup(swapped, true, { pinned: author })

    expect((await store.list()).entries[0]?.signature).toBe('mismatch')
    await expect(store.install('atlas')).rejects.toThrow(/signature/i)
    expect(installed).toEqual([])
  })

  test('a marketplace the person added keeps the key it was first signed with', async () => {
    const author = generateKeyPairSync('ed25519').privateKey
    const added = hostedMarketplace([{ name: 'atlas', version: '1.0.0' }], author)
    const { store, trust } = setup(added, false)

    expect((await store.list()).entries[0]?.signature).toBe('signed')
    expect(trust.kept.get(added.url)?.keys).toEqual([publicKeyOf(author)])
  })
})
