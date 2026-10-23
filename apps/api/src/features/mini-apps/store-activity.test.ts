import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppInstallOutcome, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-activity-')
const CATALOG = 'https://catalog.example.test/mini-app-catalog.json'

/**
 * A hosted catalog offering chess at `version`, whose archive download waits until `release()`
 * — so a test can look at an install while it is in flight. Counts what is fetched.
 */
async function hosted(version = '1.0.0') {
  const state = { version, fetched: [] as string[], gate: Promise.resolve() }
  let release = () => {}
  const archives = new Map<string, Uint8Array>()
  const listing = async () => {
    const bytes = await packMiniAppFiles({
      'mini-app.json': JSON.stringify({ name: 'chess', version: state.version }),
    })
    archives.set(`chess-${state.version}.tar.gz`, bytes)
    return {
      name: 'chess',
      displayName: 'Chess',
      version: state.version,
      publisher: { name: 'Localix', verified: true },
      archive: {
        url: `chess-${state.version}.tar.gz`,
        bytes: bytes.byteLength,
        sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
      },
    }
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    state.fetched.push(url)
    if (url === CATALOG) return Response.json({ schema: 1, apps: [await listing()] })
    await state.gate
    const bytes = archives.get(url.split('/').pop() ?? '')
    return bytes
      ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return {
    fetchImpl,
    state,
    hold: () => (state.gate = new Promise<void>((resolve) => (release = resolve))),
    release: () => release(),
  }
}

function storeOver(sources: MiniAppStoreSource[], fetchImpl?: typeof fetch) {
  const settled: MiniAppInstallOutcome[][] = []
  const store = createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => sources,
    onInstalled: async () => {},
    onJobsSettled: (outcomes) => void settled.push(outcomes),
    fetchImpl,
  })
  return { store, settled }
}

async function localApp(source: string, name: string, extra: Record<string, unknown> = {}) {
  await fs.mkdir(join(source, name), { recursive: true })
  await fs.writeFile(
    join(source, name, 'mini-app.json'),
    JSON.stringify({ name, version: '1.0.0', description: name, ...extra }),
  )
}

const local = (source: string): MiniAppStoreSource => ({
  kind: 'local',
  root: source,
  publisher: { name: 'Localix', verified: true },
})

afterEach(() => __resetBundledSyncCache())

describe('what the store is doing in the background', () => {
  test('an install in flight is listed by name with its progress, and gone once it lands', async () => {
    const catalog = await hosted()
    const { store } = storeOver(
      [{ kind: 'catalog', url: CATALOG, vouches: true }],
      catalog.fetchImpl,
    )
    catalog.hold()
    const downloading = new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        if (store.jobs().get('chess')?.phase !== 'downloading') return
        stop()
        resolve()
      })
    })
    await store.install('chess')
    expect((await store.activity()).jobs).toEqual([
      expect.objectContaining({ name: 'chess', displayName: 'Chess', phase: 'queued' }),
    ])
    // The archive's download waits on the gate.
    await downloading
    const during = await store.activity()
    expect(during.jobs).toEqual([
      expect.objectContaining({
        name: 'chess',
        displayName: 'Chess',
        kind: 'install',
        version: '1.0.0',
        phase: 'downloading',
      }),
    ])
    catalog.release()
    await store.settled()
    expect((await store.activity()).jobs).toEqual([])
  })

  test('an update the catalogs already offer is listed without reading any catalog again', async () => {
    const catalog = await hosted()
    const { store } = storeOver(
      [{ kind: 'catalog', url: CATALOG, vouches: true }],
      catalog.fetchImpl,
    )
    expect((await store.activity()).updates).toEqual([])
    // Nothing read yet: the background read never goes to the network on its own.
    expect(catalog.state.fetched).toEqual([])

    await store.install('chess')
    await store.settled()
    catalog.state.version = '1.1.0'
    // Another start of the app: its store page reads the catalog, which now offers 1.1.0.
    const later = storeOver(
      [{ kind: 'catalog', url: CATALOG, vouches: true }],
      catalog.fetchImpl,
    ).store
    await later.list()
    const fetchedBefore = catalog.state.fetched.length
    expect((await later.activity()).updates).toEqual([
      expect.objectContaining({ name: 'chess', displayName: 'Chess', from: '1.0.0', to: '1.1.0' }),
    ])
    expect(catalog.state.fetched.length).toBe(fetchedBefore)
  })

  test('Update all installs the newer version of the apps a catalog put here, and says so once', async () => {
    const catalog = await hosted()
    const { store, settled } = storeOver(
      [{ kind: 'catalog', url: CATALOG, vouches: true }],
      catalog.fetchImpl,
    )
    await store.install('chess')
    await store.settled()
    catalog.state.version = '1.1.0'
    expect(await store.updateInstalled()).toEqual(['chess'])
    await store.settled()
    expect(settled.at(-1)).toEqual([
      expect.objectContaining({ name: 'chess', label: 'Chess', kind: 'update', version: '1.1.0' }),
    ])
    expect((await store.activity()).updates).toEqual([])
  })

  test('installs queued together are reported together, a failure with its reason', async () => {
    const source = join(root(), 'staged')
    await localApp(source, 'kanban', { displayName: 'Kanban' })
    await localApp(source, 'notes')
    const { store, settled } = storeOver([local(source)])
    // One whose files are gone by the time its turn comes fails; the other installs.
    await store.install('kanban')
    await store.install('notes')
    await fs.rm(join(source, 'notes'), { recursive: true })
    await store.settled()

    expect(settled).toHaveLength(1)
    const [kanban, notes] = settled[0]!
    expect(kanban).toEqual(
      expect.objectContaining({ name: 'kanban', label: 'Kanban', kind: 'install' }),
    )
    expect(kanban?.error).toBeUndefined()
    expect(notes).toEqual(
      expect.objectContaining({ name: 'notes', label: 'notes', error: expect.any(String) }),
    )
  })
})
