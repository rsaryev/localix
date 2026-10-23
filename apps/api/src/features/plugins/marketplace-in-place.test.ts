import { describe, expect, test } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { removeOwnedMarketplaceDir } from './marketplace-in-place'
import {
  addMarketplace,
  readKnownMarketplaces,
  removeMarketplace,
  resolveMarketplaceInstall,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'

const tempDir = tempDirPerTest('mkt-in-place-')

const catalog = (plugins: string[]) =>
  JSON.stringify({
    name: 'mine',
    owner: { name: 'Me' },
    plugins: plugins.map((name) => ({ name, source: `./plugins/${name}` })),
  })

/** A marketplace folder the person keeps, and a registry root of Localix's own. */
function fixture() {
  const folder = join(tempDir(), 'my-marketplace')
  writeTree(folder, {
    '.claude-plugin/marketplace.json': catalog(['one']),
    'plugins/one/.claude-plugin/plugin.json': JSON.stringify({ name: 'one' }),
  })
  const deps: MarketplaceRegistryDeps = {
    root: join(tempDir(), 'marketplaces'),
    localixDir: join(tempDir(), 'bundled'),
    now: () => '2026-01-01T00:00:00.000Z',
    cloneRepo: async () => {
      throw new Error('no network in this test')
    },
  }
  return { folder, deps, root: deps.root! }
}

describe('a marketplace added from a local folder is read in place', () => {
  test('add records the folder itself and copies nothing', async () => {
    const { folder, deps, root } = fixture()
    expect(await addMarketplace({ source: 'local', path: folder }, deps)).toEqual({
      name: 'mine',
      count: 1,
    })
    expect((await readKnownMarketplaces(root)).mine?.installLocation).toBe(folder)
    expect(existsSync(join(root, 'mine'))).toBe(false)

    const resolved = await resolveMarketplaceInstall({ plugin: 'one', marketplace: 'mine' }, deps)
    expect(resolved.dir).toBe(join(folder, 'plugins', 'one'))
    expect(resolved.inPlace).toBe(true)
  })

  test('remove forgets the marketplace and leaves the folder', async () => {
    const { folder, deps, root } = fixture()
    await addMarketplace({ source: 'local', path: folder }, deps)
    await removeMarketplace('mine', deps)
    expect(await readKnownMarketplaces(root)).toEqual({})
    expect(existsSync(join(folder, '.claude-plugin', 'marketplace.json'))).toBe(true)
    expect(existsSync(join(folder, 'plugins', 'one', '.claude-plugin', 'plugin.json'))).toBe(true)
  })

  test('update re-reads the folder and leaves it', async () => {
    const { folder, deps } = fixture()
    await addMarketplace({ source: 'local', path: folder }, deps)
    writeTree(folder, { '.claude-plugin/marketplace.json': catalog(['one', 'two']) })
    expect(await updateMarketplace('mine', deps)).toEqual({ name: 'mine', count: 2 })
    expect(existsSync(join(folder, 'plugins', 'one'))).toBe(true)
  })

  test('a catalog that renamed itself drops the old name without touching the folder', async () => {
    const { folder, deps, root } = fixture()
    await addMarketplace({ source: 'local', path: folder }, deps)
    const renamed = JSON.parse(catalog(['one'])) as Record<string, unknown>
    writeTree(folder, {
      '.claude-plugin/marketplace.json': JSON.stringify({ ...renamed, name: 'mine-v2' }),
    })
    expect((await updateMarketplace('mine', deps)).name).toBe('mine-v2')
    expect(Object.keys(await readKnownMarketplaces(root))).toEqual(['mine-v2'])
    expect(existsSync(join(folder, 'plugins', 'one', '.claude-plugin', 'plugin.json'))).toBe(true)
  })

  test('re-adding a marketplace an older build copied retires that copy, not the folder', async () => {
    const { folder, deps, root } = fixture()
    const oldCopy = join(root, 'mine')
    writeTree(oldCopy, {
      '.claude-plugin/marketplace.json': catalog(['one']),
      'plugins/one/.claude-plugin/plugin.json': JSON.stringify({ name: 'one' }),
    })
    await fs.writeFile(
      join(root, 'known.json'),
      JSON.stringify({
        mine: { source: { source: 'local', path: folder }, installLocation: oldCopy },
      }),
    )
    // The old copy still resolves as a copy until the marketplace is updated.
    const before = await resolveMarketplaceInstall({ plugin: 'one', marketplace: 'mine' }, deps)
    expect(before.inPlace).toBeUndefined()

    await updateMarketplace('mine', deps)
    expect((await readKnownMarketplaces(root)).mine?.installLocation).toBe(folder)
    expect(existsSync(oldCopy)).toBe(false)
    expect(existsSync(join(folder, '.claude-plugin', 'marketplace.json'))).toBe(true)
  })
})

describe('removeOwnedMarketplaceDir', () => {
  test('deletes only a directory strictly inside the marketplaces root', async () => {
    const root = join(tempDir(), 'marketplaces')
    const outside = join(tempDir(), 'mine')
    writeTree(root, { 'copy/x': 'x' })
    writeTree(outside, { x: 'x' })
    await removeOwnedMarketplaceDir(root, outside)
    await removeOwnedMarketplaceDir(root, root)
    await removeOwnedMarketplaceDir(root, join(root, '..', 'mine'))
    expect(existsSync(join(outside, 'x'))).toBe(true)
    expect(existsSync(root)).toBe(true)
    await removeOwnedMarketplaceDir(root, join(root, 'copy'))
    expect(existsSync(join(root, 'copy'))).toBe(false)
  })
})
