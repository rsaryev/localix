import { expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  findMarketplacesWithPlugin,
  listMarketplaces,
  closureMarketplaces,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { type KnownMarketplace, readKnownMarketplaces, writeKnownMarketplaces } from './kit'

test('an unreadable registered catalog stays listed but contributes no plugins or permissions', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'marketplace-unreadable-'))
  try {
    const catalog = join(root, 'broken')
    await fs.mkdir(catalog)
    await fs.writeFile(join(catalog, 'marketplace.json'), '{broken')
    const known: Record<string, KnownMarketplace> = {
      broken: {
        source: { kind: 'directory', path: catalog },
        installLocation: catalog,
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    }
    await writeKnownMarketplaces(root, known)
    const deps: MarketplaceRegistryDeps = {
      root,
      cloneRepo: async () => {
        throw new Error('Catalog queries must not clone')
      },
    }

    // Listed with the reason it cannot be read, so the picker can say why it is empty.
    expect(await listMarketplaces(deps)).toEqual([
      {
        name: 'broken',
        count: 0,
        plugins: [],
        unsupported: expect.stringContaining('No .claude-plugin/marketplace.json'),
      },
    ])
    expect(await findMarketplacesWithPlugin('anything', deps)).toEqual([])
    expect(await closureMarketplaces(deps)).toEqual([])
    expect(await readKnownMarketplaces(root)).toEqual(known)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
