import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { DiscoveredPlugin } from './discovery'
import { prepareDependenciesForInstall } from './dependencies-install'
import { addMarketplace, resolveMarketplaceInstall } from './marketplace-registry'

/**
 * A dependency counts as there only when it is installed at the scope the plugin installs to
 * (dependencies.md, "Depend on a plugin from another marketplace": "installed and enabled at the
 * same scope"): a project's copy does not satisfy a user-wide install.
 */

const dir = tempDirPerTest('deps-scope-')

const installed = (name: string, scope: 'global' | 'project') =>
  ({
    manifest: { name },
    rawManifest: { name },
    scope,
    projectId: scope === 'project' ? 'p1' : '',
  }) as unknown as DiscoveredPlugin

describe('a dependency installed at another scope', () => {
  it('is installed again at the scope of the plugin that needs it', async () => {
    writeTree(join(dir(), 'catalog'), {
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'acme',
        owner: { name: 'A' },
        plugins: [
          { name: 'app', source: './app' },
          { name: 'lib', source: './lib' },
        ],
      }),
      'app/.claude-plugin/plugin.json': JSON.stringify({ name: 'app', dependencies: ['lib'] }),
      'lib/.claude-plugin/plugin.json': JSON.stringify({ name: 'lib' }),
    })
    const deps = {
      root: join(dir(), 'marketplaces'),
      cloneRepo: async (_url: string, dest: string) => {
        await fs.cp(join(dir(), 'catalog'), dest, { recursive: true })
      },
    }
    await addMarketplace({ source: 'github', repo: 'acme/catalog' }, deps)
    const resolved = await resolveMarketplaceInstall({ plugin: 'app', marketplace: 'acme' }, deps)

    const globalInstall = await prepareDependenciesForInstall(
      resolved,
      deps,
      [installed('lib', 'project')],
      'global',
    )
    expect(globalInstall.toInstall).toEqual(['lib'])
    const projectInstall = await prepareDependenciesForInstall(
      resolved,
      deps,
      [installed('lib', 'project')],
      'project',
    )
    expect(projectInstall.toInstall).toEqual([])
  })
})
