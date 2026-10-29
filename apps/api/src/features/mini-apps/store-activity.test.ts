import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog } from '../../testing/mini-app-catalog'
import { createMiniAppStore, type MiniAppInstallOutcome, type MiniAppStoreSource } from './store'

const root = tempDirPerTest('mini-app-store-activity-')
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

describe('the mini app store’s background updates and installs', () => {
  test('Update all installs the newer version of the apps a catalog put here, and says so once', async () => {
    const catalog = hostedMiniAppCatalog([{ name: 'chess', displayName: 'Chess' }])
    const { store, settled } = storeOver(
      [{ kind: 'catalog', url: catalog.url, vouches: true }],
      catalog.fetchImpl,
    )
    await store.install('chess')
    await store.settled()
    catalog.apps[0]!.version = '1.1.0'
    expect(await store.updateInstalled()).toEqual(['chess'])
    await store.settled()
    expect(settled.at(-1)).toEqual([
      expect.objectContaining({ name: 'chess', label: 'Chess', kind: 'update', version: '1.1.0' }),
    ])
  })

  test('installs queued together are reported together, a failure with its reason', async () => {
    const catalog = hostedMiniAppCatalog([
      { name: 'kanban', displayName: 'Kanban' },
      { name: 'notes', corrupt: true },
    ])
    const { store, settled } = storeOver(
      [{ kind: 'catalog', url: catalog.url, vouches: true }],
      catalog.fetchImpl,
    )
    // One whose archive fails its checksum when its turn comes fails; the other installs.
    await store.install('kanban')
    await store.install('notes')
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
