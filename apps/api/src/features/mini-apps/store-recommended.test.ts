import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-recommended-')
const CATALOG = 'https://catalog.example.test/mini-app-catalog.json'

/** A hosted catalog whose one app, `habits`, says it is recommended. */
async function hosted() {
  const archive = await packMiniAppFiles({
    'mini-app.json': JSON.stringify({ name: 'habits', version: '1.0.0' }),
  })
  const app = {
    name: 'habits',
    displayName: 'Habits',
    version: '1.0.0',
    publisher: { name: 'Localix', verified: true },
    recommended: true,
    archive: {
      url: 'git.tar.gz',
      bytes: archive.byteLength,
      sha256: new Bun.CryptoHasher('sha256').update(archive).digest('hex'),
    },
  }
  return (async (input: string | URL | Request) =>
    String(input instanceof Request ? input.url : input) === CATALOG
      ? Response.json({ schema: 1, apps: [app] })
      : new Response('missing', { status: 404 })) as unknown as typeof fetch
}

const storeOver = (sources: MiniAppStoreSource[], fetchImpl?: typeof fetch) =>
  createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => sources,
    onInstalled: async () => {},
    fetchImpl,
  })

/** A folder of built apps, as development stages them, with the picks Localix makes. */
async function staged(picks?: Record<string, string[]>) {
  const source = join(root(), 'staged')
  for (const name of ['kanban', 'chess']) {
    await fs.mkdir(join(source, name), { recursive: true })
    await fs.writeFile(
      join(source, name, 'mini-app.json'),
      JSON.stringify({ name, version: '1.0.0', description: name }),
    )
  }
  if (picks) await fs.writeFile(join(source, 'catalog-picks.json'), JSON.stringify(picks))
  return source
}

afterEach(() => __resetBundledSyncCache())

describe('recommended mini apps', () => {
  test('a catalog Localix vouches for marks the apps it recommends', async () => {
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: true }], await hosted())
    expect((await store.list()).entries[0]).toMatchObject({
      name: 'habits',
      recommended: true,
    })
  })

  test('a catalog someone added cannot recommend itself', async () => {
    const store = storeOver([{ kind: 'catalog', url: CATALOG, vouches: false }], await hosted())
    expect((await store.list()).entries[0]?.recommended).toBeUndefined()
  })

  test('the staged first-party folder takes its picks from the list beside the apps', async () => {
    const source = await staged({ recommended: ['kanban'], featured: ['chess'] })
    const store = storeOver([
      {
        kind: 'local',
        root: source,
        publisher: { name: 'Localix', verified: true },
        vouches: true,
      },
    ])
    const byName = Object.fromEntries((await store.list()).entries.map((e) => [e.name, e]))
    expect(byName.kanban?.recommended).toBe(true)
    expect(byName.kanban?.featured).toBeUndefined()
    expect(byName.chess?.featured).toBe(true)
    expect(byName.chess?.recommended).toBeUndefined()
  })

  test('a folder Localix does not vouch for has no picks, whatever it says', async () => {
    const source = await staged({ recommended: ['kanban'], featured: ['chess'] })
    const store = storeOver([
      { kind: 'local', root: source, publisher: { name: 'Ada', verified: false } },
    ])
    const entries = (await store.list()).entries
    expect(entries.some((entry) => entry.recommended || entry.featured)).toBe(false)
  })
})
