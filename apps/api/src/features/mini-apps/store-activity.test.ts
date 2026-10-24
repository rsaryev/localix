import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppInstallOutcome, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-activity-')
const CATALOG = 'https://catalog.example.test/mini-app-catalog.json'

/** A hosted catalog offering chess at `version`; a test raises the version it offers. */
async function hosted(version = '1.0.0') {
  const state = { version }
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
    if (url === CATALOG) return Response.json({ schema: 1, apps: [await listing()] })
    const bytes = archives.get(url.split('/').pop() ?? '')
    return bytes
      ? new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))
      : new Response('missing', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, state }
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

describe('the mini app store’s background updates and installs', () => {
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
