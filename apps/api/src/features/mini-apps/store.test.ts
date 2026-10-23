import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-')

async function offer(source: string, name: string, extra: Record<string, unknown> = {}) {
  await fs.mkdir(join(source, name), { recursive: true })
  await fs.writeFile(
    join(source, name, 'mini-app.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} app`, ...extra }),
  )
}

function setup() {
  const source = join(root(), 'staged')
  const home = join(root(), 'home')
  const changes: string[] = []
  let pokes = 0
  const local: MiniAppStoreSource = {
    kind: 'local',
    root: source,
    publisher: { name: 'Localix', verified: true },
  }
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [local],
    onInstalled: async (name) => void changes.push(name),
  })
  store.subscribe(() => pokes++)
  return { source, home, store, changes, pokes: () => pokes }
}

afterEach(() => __resetBundledSyncCache())

describe('the mini app store', () => {
  test('lists what a source offers, with its publisher, and nothing as installed yet', async () => {
    const { source, store } = setup()
    await offer(source, 'chess', { displayName: 'Chess', category: 'games' })
    await offer(source, 'notes')
    await offer(source, 'scaffold', { private: true })

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
    const { source, home, store, changes, pokes } = setup()
    await offer(source, 'chess')
    await offer(source, 'notes')

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
    const { source, store } = setup()
    await offer(source, 'chess')
    await store.install('chess')
    await store.settled()
    await offer(source, 'chess', { version: '1.1.0' })

    const [chess] = (await store.list()).entries
    expect(chess).toMatchObject({ installed: { version: '1.0.0' }, version: '1.1.0', update: true })
  })

  test('an app no source offers is refused, saying which', async () => {
    const { store } = setup()
    await expect(store.install('ghost')).rejects.toThrow(/ghost/)
  })
})
