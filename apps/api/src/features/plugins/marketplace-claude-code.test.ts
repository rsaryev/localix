import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  addMarketplace,
  listMarketplaces,
  resolveMarketplaceInstall,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { fetchUrl, stubFetch } from '../../testing/fetch-stub'

/**
 * Claude Code marketplaces (`.claude-plugin/marketplace.json`) through the registry, against the
 * rules in code.claude.com/docs/en/plugins/marketplace-reference: every `marketplace add` input
 * form, every plugin source kind, reserved names, and an entry that is the plugin's manifest.
 */

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const dir = tempDirPerTest('cc-marketplace')
const catalog = (plugins: unknown[], name = 'acme-tools') =>
  JSON.stringify({ name, owner: { name: 'Acme' }, plugins })

/** Registry deps rooted in the test dir; clones record their arguments and copy `upstream`. */
function registry(upstream?: string) {
  const clones: Array<{ url: string; ref?: string; sparse?: string | string[] }> = []
  const deps: MarketplaceRegistryDeps = {
    root: join(dir(), 'registry'),
    cloneRepo: async (url, dest, ref, sparse) => {
      clones.push({ url, ...(ref ? { ref } : {}), ...(sparse ? { sparse } : {}) })
      if (!upstream) throw new Error('no upstream')
      await fs.cp(upstream, dest, { recursive: true })
    },
  }
  return { deps, clones }
}

describe('reserved marketplace names', () => {
  it('a reserved name is refused at add time', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, { '.claude-plugin/marketplace.json': catalog([], 'claude-code-plugins') })
    const { deps } = registry(upstream)
    await expect(addMarketplace({ kind: 'directory', path: upstream }, deps)).rejects.toThrow(
      'reserved',
    )
  })
})

describe('Claude Code catalogs through the registry', () => {
  it('drops an entry that is invalid on its own, not the marketplace', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, {
      '.claude-plugin/marketplace.json': catalog([
        { name: 'bad name', source: './x' },
        { name: 'good', source: './plugins/good' },
      ]),
    })
    const { deps } = registry()
    expect(await addMarketplace({ kind: 'directory', path: upstream }, deps)).toEqual({
      name: 'acme-tools',
      count: 1,
    })
    const [listing] = await listMarketplaces(deps)
    expect(listing?.plugins.map((p) => p.name)).toEqual(['good'])
  })

  it('adds a catalog file with its marketplace root, so relative sources resolve', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, {
      '.claude-plugin/marketplace.json': catalog([{ name: 'good', source: './plugins/good' }]),
      'plugins/good/.claude-plugin/plugin.json': JSON.stringify({ name: 'good' }),
    })
    const { deps } = registry()
    const file = join(upstream, '.claude-plugin', 'marketplace.json')
    await addMarketplace({ kind: 'file', path: file }, deps)
    const res = await resolveMarketplaceInstall({ plugin: 'good', marketplace: 'acme-tools' }, deps)
    // Read where it is, its marketplace two folders up.
    expect(res.dir).toBe(join(upstream, 'plugins', 'good'))
  })

  it('fails a relative source whose directory does not exist, naming the path', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, {
      '.claude-plugin/marketplace.json': catalog([{ name: 'gone', source: './plugins/gone' }]),
    })
    const { deps } = registry()
    await addMarketplace({ kind: 'directory', path: upstream }, deps)
    await expect(
      resolveMarketplaceInstall({ plugin: 'gone', marketplace: 'acme-tools' }, deps),
    ).rejects.toThrow('Source path does not exist')
  })

  it('a hosted catalog is fetched alone: remote entries install, relative ones are refused', async () => {
    const plugins = [
      { name: 'local-one', source: './plugins/local-one' },
      {
        name: 'mono',
        source: {
          source: 'git-subdir',
          url: 'acme/monorepo',
          path: 'tools/mono',
          ref: 'main',
          sha: 'a'.repeat(40),
        },
      },
    ]
    globalThis.fetch = stubFetch(async (input) => {
      expect(fetchUrl(input)).toBe('https://example.com/marketplace.json')
      return new Response(catalog(plugins))
    })
    const upstream = join(dir(), 'monorepo')
    writeTree(upstream, {
      'tools/mono/.claude-plugin/plugin.json': JSON.stringify({ name: 'mono' }),
    })
    const { deps, clones } = registry(upstream)
    await addMarketplace({ kind: 'url', url: 'https://example.com/marketplace.json' }, deps)

    await expect(
      resolveMarketplaceInstall({ plugin: 'local-one', marketplace: 'acme-tools' }, deps),
    ).rejects.toThrow('cannot resolve')
    const res = await resolveMarketplaceInstall({ plugin: 'mono', marketplace: 'acme-tools' }, deps)
    expect(clones).toEqual([
      { url: 'https://github.com/acme/monorepo.git', ref: 'a'.repeat(40), sparse: 'tools/mono' },
    ])
    expect(await fs.readFile(join(res.dir, '.claude-plugin/plugin.json'), 'utf8')).toContain('mono')
    // Updating re-downloads the catalog from its URL.
    expect(await updateMarketplace('acme-tools', deps)).toEqual({ name: 'acme-tools', count: 2 })
  })

  it('a git-subdir path cannot leave its checkout', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, {
      '.claude-plugin/marketplace.json': catalog([
        { name: 'evil', source: { source: 'git-subdir', url: 'https://h/r.git', path: '/etc' } },
      ]),
    })
    const { deps } = registry(join(dir(), 'up'))
    await addMarketplace({ kind: 'directory', path: upstream }, deps)
    await expect(
      resolveMarketplaceInstall({ plugin: 'evil', marketplace: 'acme-tools' }, deps),
    ).rejects.toThrow('must be inside the repository')
  })
})
