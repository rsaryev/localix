import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog, type CatalogEntry } from '../../testing/mini-app-catalog'
import { createMiniAppStore, type MiniAppJob } from './store'

const root = tempDirPerTest('mini-app-store-catalog-')
/** A hosted catalog offering these apps. */
const hostedCatalog = (apps: CatalogEntry[]) => hostedMiniAppCatalog(apps)

/** The public key a catalog signature names, as Localix keeps it. */
const keptKey = (pair: { publicKey: KeyObject }) =>
  Buffer.from(pair.publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64')

function setup(
  catalog: ReturnType<typeof hostedCatalog>,
  vouches = true,
  trust: {
    key?: string
    pinKey?: (url: string, key: string) => Promise<void>
    autoUpdateOff?: () => Promise<ReadonlySet<string>>
  } = {},
) {
  const home = join(root(), 'home')
  const installed: { name: string; fresh: boolean }[] = []
  const phases: MiniAppJob[] = []
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [
      { kind: 'catalog', url: catalog.url, vouches, ...(trust.key ? { key: trust.key } : {}) },
    ],
    onInstalled: async (name, { fresh }) => void installed.push({ name, fresh }),
    fetchImpl: catalog.fetchImpl,
    ...(trust.pinKey ? { pinKey: trust.pinKey } : {}),
    ...(trust.autoUpdateOff ? { autoUpdateOff: trust.autoUpdateOff } : {}),
  })
  store.subscribe(() => {
    const job = store.jobs().get('atlas')
    if (job) phases.push({ ...job })
  })
  const appDir = join(home, '.localix', 'mini-apps', 'atlas')
  return { home, store, installed, phases, appDir }
}

describe('the mini app store, from a hosted catalog', () => {
  test('downloads the archive with progress, checks it and installs it', async () => {
    const { store, installed, phases, appDir } = setup(
      hostedCatalog([{ name: 'atlas', version: '1.0.0' }]),
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
    const first = setup(hostedCatalog([{ name: 'atlas', version: '1.0.0' }]))
    await first.store.install('atlas')
    await first.store.settled()

    const { store, appDir } = setup(
      hostedCatalog([{ name: 'atlas', version: '1.1.0', corrupt: true }]),
    )
    await store.install('atlas')
    await store.settled()

    expect(store.jobs().get('atlas')).toMatchObject({ phase: 'failed' })
    expect(store.jobs().get('atlas')?.error).toContain('checksum')
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# atlas 1.0.0')
  })

  test('a publisher the source does not vouch for is unverified and waits for a yes', async () => {
    const { store, installed } = setup(hostedCatalog([{ name: 'atlas', version: '1.0.0' }]), false)
    expect((await store.list()).entries[0]?.publisher.verified).toBe(false)
    await expect(store.install('atlas')).rejects.toThrow(/unverified/i)
    await store.install('atlas', { acceptUnverified: true })
    await store.settled()
    expect(installed.map(({ name }) => name)).toEqual(['atlas'])
  })

  test('an app built for a newer Localix is listed as incompatible and not installed', async () => {
    const { store } = setup(hostedCatalog([{ name: 'atlas', version: '1.0.0', apiVersion: 99 }]))
    expect((await store.list()).entries[0]?.incompatible).toBe(true)
    await expect(store.install('atlas')).rejects.toThrow(/newer Localix/)
  })

  test('updates are installed for what the catalog put there, never for a folder of yours', async () => {
    const before = setup(hostedCatalog([{ name: 'atlas', version: '1.0.0' }]))
    await before.store.install('atlas')
    await before.store.settled()
    const mine = join(before.home, '.localix', 'mini-apps', 'notes')
    await fs.mkdir(mine, { recursive: true })
    await fs.writeFile(
      join(mine, 'mini-app.json'),
      JSON.stringify({ name: 'notes', version: '0.1.0' }),
    )

    const author = generateKeyPairSync('ed25519')
    const { store, installed, appDir } = setup(
      hostedMiniAppCatalog(
        [
          { name: 'atlas', version: '1.1.0' },
          { name: 'notes', version: '2.0.0' },
        ],
        { signWith: author.privateKey },
      ),
      true,
      { key: keptKey(author) },
    )
    expect(await store.updateInstalled()).toEqual(['atlas'])
    await store.settled()
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# atlas 1.1.0')
    expect(installed).toEqual([{ name: 'atlas', fresh: false }])
    await expect(store.install('notes')).rejects.toThrow(/yours/)
  })

  test('a catalog that cannot be reached is a problem of the listing, not an empty store', async () => {
    const down = {
      ...hostedCatalog([]),
      fetchImpl: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
    }
    const { store } = setup(down)
    const listing = await store.list()
    expect(listing.entries).toEqual([])
    expect(listing.problems[0]).toContain('503')
  })

  test('updates come on their own only from a catalog signed with the key kept for it', async () => {
    const author = generateKeyPairSync('ed25519')
    const signed = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }], {
      signWith: author.privateKey,
    })
    const { store } = setup(signed, true, { key: keptKey(author) })
    await store.install('atlas')
    await store.settled()
    expect((await store.list()).entries[0]?.signature).toBe('signed')

    signed.apps[0]!.version = '1.1.0'
    expect(await store.updateInstalled()).toEqual(['atlas'])
  })

  test('an app from an unsigned catalog is offered its update but never takes it alone', async () => {
    const unsigned = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }])
    const { store } = setup(unsigned)
    await store.install('atlas')
    await store.settled()

    unsigned.apps[0]!.version = '1.1.0'
    expect(await store.updateInstalled()).toEqual([])
    await store.refresh()
    expect((await store.list()).entries[0]).toMatchObject({ signature: 'unsigned', update: true })
  })

  test('an app the person keeps from updating on its own waits for them', async () => {
    const author = generateKeyPairSync('ed25519')
    const signed = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }], {
      signWith: author.privateKey,
    })
    const { store } = setup(signed, true, {
      key: keptKey(author),
      autoUpdateOff: async () => new Set(['atlas']),
    })
    await store.install('atlas')
    await store.settled()

    signed.apps[0]!.version = '1.1.0'
    expect(await store.updateInstalled()).toEqual([])
  })

  test('a catalog signed with another key than the one kept for it installs nothing', async () => {
    const author = generateKeyPairSync('ed25519')
    const impostor = generateKeyPairSync('ed25519')
    const swapped = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }], {
      signWith: impostor.privateKey,
    })
    const { store, installed } = setup(swapped, true, { key: keptKey(author) })

    expect((await store.list()).entries[0]?.signature).toBe('mismatch')
    await expect(store.install('atlas')).rejects.toThrow(/signature/i)
    expect(installed).toEqual([])
  })

  test('a catalog the person added keeps the key it was first signed with', async () => {
    const author = generateKeyPairSync('ed25519')
    const added = hostedMiniAppCatalog([{ name: 'atlas', version: '1.0.0' }], {
      signWith: author.privateKey,
    })
    const pinned: Array<[string, string]> = []
    const { store } = setup(added, false, {
      pinKey: async (url, key) => void pinned.push([url, key]),
    })

    expect((await store.list()).entries[0]?.signature).toBe('signed')
    expect(pinned).toEqual([[added.url, keptKey(author)]])
  })
})
