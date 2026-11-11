import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  addMarketplace,
  removeMarketplace,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { readKnownMarketplaces } from './kit'

/**
 * A catalog name registered from one source is never re-pointed at another by a later add (or by
 * `install --marketplace`, which adds through the same path): the installed plugins would follow
 * the new source on their next update.
 */

const dir = tempDirPerTest('mkt-hijack')
const CATALOG = '.claude-plugin/marketplace.json'

function setup(): { deps: MarketplaceRegistryDeps; root: string; cloned: string[] } {
  const base = dir()
  const catalog = (owner: string) =>
    JSON.stringify({
      name: 'acme',
      owner: { name: owner },
      plugins: [{ name: 'cool', source: './cool', description: owner }],
    })
  writeTree(join(base, 'real'), {
    [CATALOG]: catalog('real'),
    'cool/.claude-plugin/plugin.json': '{"name":"cool"}',
  })
  writeTree(join(base, 'evil'), {
    [CATALOG]: catalog('evil'),
    'cool/.claude-plugin/plugin.json': '{"name":"cool"}',
  })
  const cloned: string[] = []
  const root = join(base, 'marketplaces')
  return {
    root,
    cloned,
    deps: {
      root,
      cloneRepo: async (url, dest) => {
        cloned.push(url)
        await fs.cp(join(base, url.includes('evil') ? 'evil' : 'real'), dest, { recursive: true })
      },
    },
  }
}

const catalogOwner = async (root: string) =>
  JSON.parse(await fs.readFile(join(root, 'acme', '.claude-plugin', 'marketplace.json'), 'utf8'))
    .owner.name

describe('marketplace name already registered from another source', () => {
  it('refuses the add and keeps the registered marketplace and its files', async () => {
    const { deps, root } = setup()
    await addMarketplace({ kind: 'github', repo: 'acme/plugins', path: CATALOG }, deps)

    await expect(
      addMarketplace({ kind: 'github', repo: 'evil/plugins', path: CATALOG }, deps),
    ).rejects.toThrow(
      'Marketplace "acme" is already added from a different source (github:acme/plugins). To use this source instead, remove that marketplace first with /plugin marketplace remove acme.',
    )
    expect((await readKnownMarketplaces(root)).acme?.source).toEqual({
      kind: 'github',
      repo: 'acme/plugins',
      path: CATALOG,
    })
    expect(await catalogOwner(root)).toBe('real')
    expect((await fs.readdir(root)).filter((name) => name.startsWith('.staging-'))).toEqual([])
  })

  it('re-adds and updates from the same source, and takes the new source after a remove', async () => {
    const { deps, root } = setup()
    await addMarketplace({ kind: 'github', repo: 'acme/plugins', path: CATALOG }, deps)
    expect(
      await addMarketplace({ kind: 'github', repo: 'acme/plugins', path: CATALOG }, deps),
    ).toEqual({
      name: 'acme',
      count: 1,
    })
    expect(await updateMarketplace('acme', deps)).toEqual({ name: 'acme', count: 1 })

    await removeMarketplace('acme', deps)
    await addMarketplace({ kind: 'github', repo: 'evil/plugins', path: CATALOG }, deps)
    expect(await catalogOwner(root)).toBe('evil')
  })
})
