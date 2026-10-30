import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog } from '../../testing/mini-app-catalog'
import { createMiniAppStore } from './store'

const root = tempDirPerTest('mini-app-store-')

function setup() {
  const catalog = hostedMiniAppCatalog([
    { name: 'atlas', displayName: 'Atlas', category: 'games' },
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
    expect(entries.map((entry) => entry.name)).toEqual(['atlas', 'notes'])
    expect(entries[0]).toMatchObject({
      displayName: 'Atlas',
      category: 'games',
      version: '1.0.0',
      publisher: { name: 'Localix', verified: true },
      installed: null,
      update: false,
    })
  })

  test('installing one goes through its phases, announces it, and lists it as installed', async () => {
    const { home, store, changes, pokes } = setup()

    await store.install('atlas')
    await store.settled()

    expect(changes).toEqual(['atlas'])
    expect(pokes()).toBeGreaterThan(1)
    expect(await fs.readdir(join(home, '.localix', 'mini-apps'))).toContain('atlas')
    const { entries } = await store.list()
    expect(entries.find((entry) => entry.name === 'atlas')).toMatchObject({
      installed: { version: '1.0.0' },
      job: { phase: 'done' },
    })
    expect(entries.find((entry) => entry.name === 'notes')?.installed).toBeNull()
  })

  test('two installs of one app asked at once run one job', async () => {
    const { store, changes } = setup()
    await Promise.all([store.install('atlas'), store.install('atlas')])
    await store.settled()
    expect(changes).toEqual(['atlas'])
  })

  test('a newer version offered than installed is an update', async () => {
    const { catalog, store } = setup()
    await store.install('atlas')
    await store.settled()
    catalog.apps[0]!.version = '1.1.0'
    // The catalog is read again once its hold has passed; an update check reads it afresh.
    await store.refresh()

    const [atlas] = (await store.list()).entries
    expect(atlas).toMatchObject({ installed: { version: '1.0.0' }, version: '1.1.0', update: true })
  })

  test('an app the person made is theirs: a catalog with its name offers no update to it', async () => {
    const { home, store } = setup()
    const dir = join(home, '.localix', 'mini-apps', 'atlas')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      join(dir, 'mini-app.json'),
      JSON.stringify({ name: 'atlas', version: '2.0.0' }),
    )
    await fs.writeFile(
      join(dir, '.localix-install.json'),
      JSON.stringify({ kind: 'localix-local-install', source: '/src/atlas', version: '2.0.0' }),
    )

    const [atlas] = (await store.list()).entries
    expect(atlas).toMatchObject({
      installed: { version: '2.0.0' },
      version: '1.0.0',
      update: false,
    })
    expect(await store.updateInstalled()).toEqual([])
  })

  test('an app no source offers is refused, saying which', async () => {
    const { store } = setup()
    await expect(store.install('ghost')).rejects.toThrow(/ghost/)
  })
})
