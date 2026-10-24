import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { marketplaceDependencyResolver } from './dependencies-install'
import { addMarketplace, type MarketplaceRegistryDeps } from './marketplace-registry'

/**
 * A dependency's version range resolves against `<plugin>--v<version>` git tags on the repository
 * that hosts it (dependencies.md, "How a constraint resolves against tags"): the highest tag in
 * range installs, and none in range fails the install.
 */

const dir = tempDirPerTest('dep-tags-')

async function setup() {
  writeTree(join(dir(), 'catalog'), {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'acme',
      owner: { name: 'A' },
      plugins: [{ name: 'vault', source: { source: 'github', repo: 'acme/vault' } }],
    }),
  })
  const checkouts: (string | undefined)[] = []
  const deps: MarketplaceRegistryDeps = {
    root: join(dir(), 'marketplaces'),
    cloneRepo: async (url, dest, ref) => {
      if (url.includes('vault')) {
        checkouts.push(ref)
        writeTree(dest, { '.claude-plugin/plugin.json': JSON.stringify({ name: 'vault' }) })
      } else await fs.cp(join(dir(), 'catalog'), dest, { recursive: true })
    },
    listTags: async () => [
      'vault--v2.0.0',
      'vault--v2.1.0',
      'vault--v2.1.3',
      'vault--v3.0.0',
      'other--v9.0.0',
    ],
  }
  await addMarketplace({ source: 'github', repo: 'acme/catalog' }, deps)
  return { deps, checkouts }
}

describe('a version-constrained dependency', () => {
  it('installs the highest tag in range, reporting the tag version', async () => {
    const { deps, checkouts } = await setup()
    const step = await marketplaceDependencyResolver(deps, new Map()).resolveFromMarketplace(
      'vault',
      'acme',
      '~2.1.0',
    )
    expect(checkouts).toEqual(['vault--v2.1.3'])
    expect(step.version).toBe('2.1.3')
  })

  it('fails when no tag satisfies the range', async () => {
    const { deps } = await setup()
    await expect(
      marketplaceDependencyResolver(deps, new Map()).resolveFromMarketplace('vault', 'acme', '^4'),
    ).rejects.toThrow('Dependency "vault@acme" has no git tag satisfying "^4"')
  })
})
