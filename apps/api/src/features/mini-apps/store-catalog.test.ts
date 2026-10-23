import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppJob } from './store'

const root = tempDirPerTest('mini-app-store-catalog-')
const CATALOG = 'https://catalog.example.test/mini-apps/catalog.json'

interface Published {
  name: string
  version: string
  apiVersion?: number
  verified?: boolean
  corrupt?: boolean
}

/** A hosted catalog: its `catalog.json` and the archives it names, served by a stub `fetch`. */
async function hostedCatalog(apps: Published[]) {
  const archives = new Map<string, Uint8Array>()
  const listed: Record<string, unknown>[] = []
  for (const app of apps) {
    const bytes = await packMiniAppFiles({
      'mini-app.json': JSON.stringify({ name: app.name, version: app.version }),
      'guide.md': `# ${app.name} ${app.version}`,
    })
    const file = `${app.name}-${app.version}.tar.gz`
    archives.set(file, bytes)
    listed.push({
      name: app.name,
      description: `${app.name} app`,
      version: app.version,
      ...(app.apiVersion ? { apiVersion: app.apiVersion } : {}),
      publisher: {
        name: app.verified === false ? 'Someone' : 'Localix',
        verified: app.verified !== false,
      },
      archive: {
        url: file,
        bytes: bytes.byteLength,
        sha256: app.corrupt
          ? 'f'.repeat(64)
          : new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      },
    })
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.href === CATALOG) return Response.json({ schema: 1, apps: listed })
    const bytes = archives.get(url.pathname.split('/').pop() ?? '')
    return bytes
      ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return fetchImpl
}

function setup(fetchImpl: typeof fetch, vouches = true) {
  const home = join(root(), 'home')
  const installed: { name: string; fresh: boolean }[] = []
  const phases: MiniAppJob[] = []
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [{ kind: 'catalog', url: CATALOG, vouches }],
    onInstalled: async (name, { fresh }) => void installed.push({ name, fresh }),
    fetchImpl,
  })
  store.subscribe(() => {
    const job = store.jobs().get('chess')
    if (job) phases.push({ ...job })
  })
  const appDir = join(home, '.localix', 'mini-apps', 'chess')
  return { home, store, installed, phases, appDir }
}

afterEach(() => __resetBundledSyncCache())

describe('the mini app store, from a hosted catalog', () => {
  test('downloads the archive with progress, checks it and installs it', async () => {
    const { store, installed, phases, appDir } = setup(
      await hostedCatalog([{ name: 'chess', version: '1.0.0' }]),
    )
    expect((await store.list()).entries[0]).toMatchObject({
      name: 'chess',
      version: '1.0.0',
      publisher: { name: 'Localix', verified: true },
      installed: null,
    })

    await store.install('chess')
    await store.settled()

    expect(phases.map((job) => job.phase)).toEqual(
      expect.arrayContaining(['queued', 'downloading', 'installing', 'done']),
    )
    expect(phases.find((job) => job.phase === 'downloading')?.total).toBeGreaterThan(0)
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# chess 1.0.0')
    expect(installed).toEqual([{ name: 'chess', fresh: true }])
    expect((await store.list()).entries[0]?.installed).toEqual({ version: '1.0.0' })
  })

  test('an archive that fails its checksum installs nothing and keeps the version before', async () => {
    const first = setup(await hostedCatalog([{ name: 'chess', version: '1.0.0' }]))
    await first.store.install('chess')
    await first.store.settled()

    const { store, appDir } = setup(
      await hostedCatalog([{ name: 'chess', version: '1.1.0', corrupt: true }]),
    )
    await store.install('chess')
    await store.settled()

    expect(store.jobs().get('chess')).toMatchObject({ phase: 'failed' })
    expect(store.jobs().get('chess')?.error).toContain('checksum')
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# chess 1.0.0')
  })

  test('a publisher the source does not vouch for is unverified and waits for a yes', async () => {
    const { store, installed } = setup(
      await hostedCatalog([{ name: 'chess', version: '1.0.0' }]),
      false,
    )
    expect((await store.list()).entries[0]?.publisher.verified).toBe(false)
    await expect(store.install('chess')).rejects.toThrow(/unverified/i)
    await store.install('chess', { acceptUnverified: true })
    await store.settled()
    expect(installed.map(({ name }) => name)).toEqual(['chess'])
  })

  test('an app built for a newer Localix is listed as incompatible and not installed', async () => {
    const { store } = setup(
      await hostedCatalog([{ name: 'chess', version: '1.0.0', apiVersion: 99 }]),
    )
    expect((await store.list()).entries[0]?.incompatible).toBe(true)
    await expect(store.install('chess')).rejects.toThrow(/newer Localix/)
  })

  test('updates are installed for what the catalog put there, never for a folder of yours', async () => {
    const before = setup(await hostedCatalog([{ name: 'chess', version: '1.0.0' }]))
    await before.store.install('chess')
    await before.store.settled()
    const mine = join(before.home, '.localix', 'mini-apps', 'notes')
    await fs.mkdir(mine, { recursive: true })
    await fs.writeFile(
      join(mine, 'mini-app.json'),
      JSON.stringify({ name: 'notes', version: '0.1.0' }),
    )

    const { store, installed, appDir } = setup(
      await hostedCatalog([
        { name: 'chess', version: '1.1.0' },
        { name: 'notes', version: '2.0.0' },
      ]),
    )
    expect(await store.updateInstalled()).toEqual(['chess'])
    await store.settled()
    expect(await fs.readFile(join(appDir, 'guide.md'), 'utf8')).toBe('# chess 1.1.0')
    expect(installed).toEqual([{ name: 'chess', fresh: false }])
    await expect(store.install('notes')).rejects.toThrow(/yours/)
  })

  test('a catalog that cannot be reached is a problem of the listing, not an empty store', async () => {
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
    const { store } = setup(down)
    const listing = await store.list()
    expect(listing.entries).toEqual([])
    expect(listing.problems[0]).toContain('503')
  })
})
