import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { __resetBundledSyncCache } from './bundled-install'
import { createRecommendedInstalls } from './recommended'
import { createMiniAppStore, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-recommended-')
const OFFLINE = 'https://catalog.example.test/mini-app-catalog.json'

/** The staged first-party folder: four apps, three of them recommended. */
async function firstParty() {
  const source = join(root(), 'staged')
  for (const name of ['git-workspace', 'documents', 'kanban', 'chess']) {
    await fs.mkdir(join(source, name), { recursive: true })
    await fs.writeFile(
      join(source, name, 'mini-app.json'),
      JSON.stringify({ name, version: '1.0.0', description: name }),
    )
  }
  await fs.writeFile(
    join(source, 'catalog-picks.json'),
    JSON.stringify({ recommended: ['git-workspace', 'documents', 'kanban'] }),
  )
  return source
}

async function setup() {
  const home = join(root(), 'home')
  const source = await firstParty()
  const net = { online: true }
  const local: MiniAppStoreSource = {
    kind: 'local',
    root: source,
    publisher: { name: 'Localix', verified: true },
    vouches: true,
  }
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => (net.online ? [local] : [{ kind: 'catalog', url: OFFLINE, vouches: true }]),
    onInstalled: async () => {},
    fetchImpl: (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch,
  })
  const pass = () => createRecommendedInstalls({ store, homeDir: home, userId: 'u1' }).run()
  const installed = async () =>
    (await store.list()).entries.filter((entry) => entry.installed).map((entry) => entry.name)
  return { home, net, store, pass, installed }
}

afterEach(() => __resetBundledSyncCache())

describe('recommended mini apps on a new installation', () => {
  test('are installed on the first start without asking, and only once', async () => {
    const { pass, installed } = await setup()
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'git-workspace', 'kanban'])
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'git-workspace', 'kanban'])
  })

  test('one the person removed is never added again', async () => {
    const { home, pass, installed } = await setup()
    await pass()
    await fs.rm(join(home, '.localix', 'mini-apps', 'kanban'), { recursive: true })
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'git-workspace'])
  })

  test('offline, nothing is installed and the pass asks to run again; online it installs', async () => {
    const { net, pass, installed } = await setup()
    net.online = false
    expect(await pass()).toBe('retry')
    net.online = true
    expect(await installed()).toEqual([])
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'git-workspace', 'kanban'])
  })

  test('an installation that already has mini apps is not a first start: nothing is added', async () => {
    const { store, pass, installed } = await setup()
    await store.install('chess')
    await store.settled()
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['chess'])
  })

  test('a folder of the person’s own by a recommended name is left as it is', async () => {
    const { home, pass } = await setup()
    const own = join(home, '.localix', 'mini-apps', 'kanban-own')
    await fs.mkdir(own, { recursive: true })
    // The person's folder is named kanban; it carries no install record.
    await fs.rename(own, join(home, '.localix', 'mini-apps', 'kanban'))
    await fs.writeFile(join(home, '.localix', 'mini-apps', 'kanban', 'notes.txt'), 'mine')
    expect(await pass()).toBe('done')
    expect(await fs.readdir(join(home, '.localix', 'mini-apps', 'kanban'))).toEqual(['notes.txt'])
  })
})
