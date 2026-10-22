import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  addMarketplace,
  readKnownMarketplaces,
  removeMarketplace,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { describeMarketplaceSource, sameMarketplaceSource } from './marketplace-source-identity'

/**
 * A catalog name registered from one source is never re-pointed at another by a later add (or by
 * `install --marketplace`, which adds through the same path): the installed plugins would follow
 * the new source on their next update.
 */

const dir = tempDirPerTest('mkt-hijack')

function setup(): { deps: MarketplaceRegistryDeps; root: string; cloned: string[] } {
  const base = dir()
  const catalog = (owner: string) =>
    JSON.stringify({
      name: 'acme',
      owner: { name: owner },
      plugins: [{ name: 'cool', source: './cool', description: owner }],
    })
  writeTree(join(base, 'real'), {
    '.claude-plugin/marketplace.json': catalog('real'),
    'cool/plugin.json': '{"name":"cool"}',
  })
  writeTree(join(base, 'evil'), {
    '.claude-plugin/marketplace.json': catalog('evil'),
    'cool/plugin.json': '{"name":"cool"}',
  })
  const cloned: string[] = []
  const root = join(base, 'marketplaces')
  return {
    root,
    cloned,
    deps: {
      root,
      localixDir: join(base, 'bundled'),
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
    await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)

    await expect(addMarketplace({ source: 'github', repo: 'evil/plugins' }, deps)).rejects.toThrow(
      'Marketplace "acme" is already added from a different source (github:acme/plugins). To use this source instead, remove that marketplace first with /plugin marketplace remove acme.',
    )
    expect((await readKnownMarketplaces(root)).acme?.source).toEqual({
      source: 'github',
      repo: 'acme/plugins',
    })
    expect(await catalogOwner(root)).toBe('real')
    expect((await fs.readdir(root)).filter((name) => name.startsWith('.staging-'))).toEqual([])
  })

  it('re-adds and updates from the same source, and takes the new source after a remove', async () => {
    const { deps, root } = setup()
    await addMarketplace({ source: 'github', repo: 'acme/plugins' }, deps)
    expect(await addMarketplace({ source: 'github', repo: 'Acme/Plugins.git' }, deps)).toEqual({
      name: 'acme',
      count: 1,
    })
    expect(await updateMarketplace('acme', deps)).toEqual({ name: 'acme', count: 1 })

    await removeMarketplace('acme', deps)
    await addMarketplace({ source: 'github', repo: 'evil/plugins' }, deps)
    expect(await catalogOwner(root)).toBe('evil')
  })

  it('treats a different ref, kind or path as a different source', () => {
    const github = { source: 'github', repo: 'acme/plugins' } as const
    expect(sameMarketplaceSource(github, { ...github, ref: 'v2' })).toBe(false)
    expect(
      sameMarketplaceSource(github, { source: 'git', url: 'https://github.com/acme/plugins.git' }),
    ).toBe(false)
    expect(
      sameMarketplaceSource({ source: 'local', path: '/a/b/' }, { source: 'local', path: '/a/b' }),
    ).toBe(true)
    expect(
      sameMarketplaceSource(
        { source: 'npm', package: 'p', version: '^1' },
        { source: 'npm', package: 'p', version: '^2' },
      ),
    ).toBe(false)
    expect(describeMarketplaceSource({ ...github, ref: 'v2' })).toBe('github:acme/plugins#v2')
  })
})
