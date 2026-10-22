import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  findMarketplacesWithPlugin,
  listMarketplaces,
  marketplaceDependencyAllowList,
  readKnownMarketplaces,
  type MarketplaceRegistryDeps,
  type KnownMarketplace,
} from './marketplace-registry'

test('an unreadable registered catalog stays listed but contributes no plugins or permissions', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'marketplace-unreadable-'))
  try {
    const catalog = join(root, 'broken')
    await fs.mkdir(catalog)
    await fs.writeFile(join(catalog, 'marketplace.json'), '{broken')
    const known: Record<string, KnownMarketplace> = {
      broken: { source: { source: 'local', path: catalog }, installLocation: catalog },
    }
    await fs.writeFile(join(root, 'known.json'), JSON.stringify(known))
    const deps: MarketplaceRegistryDeps = {
      root,
      localixDir: join(root, 'missing-builtin'),
      cloneRepo: async () => {
        throw new Error('Catalog queries must not clone')
      },
    }

    // Listed with the reason it cannot be read, so the picker can say why it is empty.
    expect(await listMarketplaces(deps)).toEqual([
      {
        name: 'broken',
        builtin: false,
        count: 0,
        plugins: [],
        unsupported: expect.stringContaining('No .localix-plugin/marketplace.json'),
      },
    ])
    expect(await findMarketplacesWithPlugin('anything', deps)).toEqual([])
    expect(await marketplaceDependencyAllowList('broken', deps)).toEqual([])
    expect(await readKnownMarketplaces(root)).toEqual(known)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('malformed known.json yields an empty registry without overwriting the file', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'marketplace-known-recovery-'))
  try {
    const file = join(root, 'known.json')
    await fs.writeFile(file, '{broken')

    expect(await readKnownMarketplaces(root)).toEqual({})
    expect(await fs.readFile(file, 'utf8')).toBe('{broken')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
