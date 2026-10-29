import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog } from '../../testing/mini-app-catalog'
import { createRecommendedInstalls } from './recommended'
import { createMiniAppStore } from './store'

const root = tempDirPerTest('mini-app-recommended-')

/** The Localix catalog: four apps, three of them recommended. */
async function setup() {
  const home = join(root(), 'home')
  const catalog = hostedMiniAppCatalog(
    ['habits', 'documents', 'kanban', 'chess'].map((name) => ({
      name,
      recommended: name !== 'chess',
    })),
  )
  const net = { online: true }
  const store = createMiniAppStore({
    homeDir: home,
    sources: () => [{ kind: 'catalog', url: catalog.url, vouches: true }],
    onInstalled: async () => {},
    fetchImpl: ((input, init) => {
      if (!net.online) throw new Error('offline')
      return catalog.fetchImpl(input, init)
    }) as typeof fetch,
  })
  const pass = () => createRecommendedInstalls({ store, homeDir: home, userId: 'u1' }).run()
  const installed = async () =>
    (await store.list()).entries.filter((entry) => entry.installed).map((entry) => entry.name)
  return { home, net, store, pass, installed }
}

describe('recommended mini apps on a new installation', () => {
  test('are installed on the first start without asking, and only once', async () => {
    const { pass, installed } = await setup()
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'habits', 'kanban'])
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'habits', 'kanban'])
  })

  test('one the person removed is never added again', async () => {
    const { home, pass, installed } = await setup()
    await pass()
    await fs.rm(join(home, '.localix', 'mini-apps', 'kanban'), { recursive: true })
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'habits'])
  })

  test('offline, nothing is installed and the pass asks to run again; online it installs', async () => {
    const { net, pass, installed } = await setup()
    net.online = false
    expect(await pass()).toBe('retry')
    net.online = true
    expect(await installed()).toEqual([])
    expect(await pass()).toBe('done')
    expect(await installed()).toEqual(['documents', 'habits', 'kanban'])
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
