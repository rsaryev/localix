import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { resolveMarketplaceInstall } from './marketplace-resolve'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

const dir = tempDirPerTest('marketplace-prefetch-')

function fixture(now: { at: number }) {
  const root = join(dir(), 'marketplaces')
  writeTree(root, {
    'known.json': JSON.stringify({
      acme: {
        source: { source: 'github', repo: 'acme/market' },
        installLocation: join(root, 'acme'),
      },
    }),
    'acme/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'acme',
      owner: { name: 'Acme' },
      plugins: [{ name: 'pg', source: { source: 'url', url: 'https://github.com/acme/pg.git' } }],
    }),
  })
  const clones: string[] = []
  const deps: MarketplaceRegistryDeps = {
    root,
    managedSettingsDir: join(dir(), 'managed'),
    now: () => new Date(now.at).toISOString(),
    cloneRepo: async (url, dest) => {
      clones.push(url)
      await fs.mkdir(join(dest, '.claude-plugin'), { recursive: true })
      await fs.writeFile(join(dest, '.claude-plugin', 'plugin.json'), '{"name":"pg"}')
    },
  }
  return { deps, clones }
}

describe('a plugin fetched for its Store page', () => {
  test('is what the install right after it uses, once; a later install fetches again', async () => {
    const now = { at: Date.parse('2026-10-25T10:00:00Z') }
    const { deps, clones } = fixture(now)
    const ref = { plugin: 'pg', marketplace: 'acme' }
    const shown = await resolveMarketplaceInstall(ref, deps, { prefetch: true })
    const installed = await resolveMarketplaceInstall(ref, deps)
    expect(installed.dir).toBe(shown.dir)
    expect(clones).toHaveLength(1)
    await resolveMarketplaceInstall(ref, deps)
    expect(clones).toHaveLength(2)
  })

  test('is fetched again when the page was opened too long ago', async () => {
    const now = { at: Date.parse('2026-10-25T10:00:00Z') }
    const { deps, clones } = fixture(now)
    const ref = { plugin: 'pg', marketplace: 'acme' }
    await resolveMarketplaceInstall(ref, deps, { prefetch: true })
    now.at += 11 * 60 * 1000
    await resolveMarketplaceInstall(ref, deps)
    expect(clones).toHaveLength(2)
  })
})
