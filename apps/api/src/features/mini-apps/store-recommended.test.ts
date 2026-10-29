import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { packMiniAppFiles } from './archive'
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
})
