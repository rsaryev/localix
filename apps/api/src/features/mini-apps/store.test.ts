import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog } from '../../testing/mini-app-catalog'
import { createMiniAppStore } from './store'

const root = tempDirPerTest('mini-app-store-')

function setup() {
  const catalog = hostedMiniAppCatalog([
    { name: 'chess', displayName: 'Chess', category: 'games' },
    { name: 'notes' },
  ])
  const home = join(root(), 'home')
  const changes: string[] = []
  let pokes = 0
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [{ kind: 'catalog', url: catalog.url, vouches: true }],
    onInstalled: async (name) => void changes.push(name),
    fetchImpl: catalog.fetchImpl,
  })
  store.subscribe(() => pokes++)
  return { catalog, home, store, changes, pokes: () => pokes }
}

describe('the mini app store', () => {
  test('lists what a source offers, with its publisher, and nothing as installed yet', async () => {
    const { store } = setup()

    const { entries } = await store.list()
    expect(entries.map((entry) => entry.name)).toEqual(['chess', 'notes'])
    expect(entries[0]).toMatchObject({
      displayName: 'Chess',
      category: 'games',
      version: '1.0.0',
      publisher: { name: 'Localix', verified: true },
      installed: null,
      update: false,
    })
  })

  test('installing one goes through its phases, announces it, and lists it as installed', async () => {
    const { home, store, changes, pokes } = setup()

    await store.install('chess')
    await store.settled()

    expect(changes).toEqual(['chess'])
    expect(pokes()).toBeGreaterThan(1)
    expect(await fs.readdir(join(home, '.localix', 'mini-apps'))).toContain('chess')
    const { entries } = await store.list()
    expect(entries.find((entry) => entry.name === 'chess')).toMatchObject({
      installed: { version: '1.0.0' },
      job: { phase: 'done' },
    })
    expect(entries.find((entry) => entry.name === 'notes')?.installed).toBeNull()
  })

  test('a newer version offered than installed is an update', async () => {
    const { catalog, store } = setup()
    await store.install('chess')
    await store.settled()
    catalog.apps[0]!.version = '1.1.0'
    // The catalog is read again once its hold has passed; an update check reads it afresh.
    await store.refresh()

    const [chess] = (await store.list()).entries
    expect(chess).toMatchObject({ installed: { version: '1.0.0' }, version: '1.1.0', update: true })
  })

  test('an app no source offers is refused, saying which', async () => {
    const { store } = setup()
    await expect(store.install('ghost')).rejects.toThrow(/ghost/)
  })
})
