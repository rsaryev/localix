import { afterEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { marketplaceNameProblem } from './claude-code-marketplace'
import { applyEntryManifestOverrides } from './marketplace-entry-manifest'
import {
  addMarketplace,
  listMarketplaces,
  parseMarketplaceInput,
  resolveEntrySource,
  resolveMarketplaceInstall,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import type { MarketplaceEntry } from './marketplace'
import { loadManifest } from './manifest-load'
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
  const clones: Array<{ url: string; ref?: string; sparse?: string }> = []
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

describe('marketplace add input forms (Claude Code)', () => {
  it('reads owner/repo@ref, hosted catalogs, git hosts and local catalog files', () => {
    expect(parseMarketplaceInput('acme/plugins@v1.2.0')).toEqual({
      source: 'github',
      repo: 'acme/plugins',
      ref: 'v1.2.0',
    })
    expect(parseMarketplaceInput('https://example.com/marketplace.json')).toEqual({
      source: 'url',
      url: 'https://example.com/marketplace.json',
    })
    expect(parseMarketplaceInput('https://github.com/acme/plugins')).toEqual({
      source: 'git',
      url: 'https://github.com/acme/plugins',
    })
    expect(parseMarketplaceInput('https://dev.azure.com/o/p/_git/repo#main')).toEqual({
      source: 'git',
      url: 'https://dev.azure.com/o/p/_git/repo',
      ref: 'main',
    })
    expect(parseMarketplaceInput('/srv/m/.claude-plugin/marketplace.json')).toEqual({
      source: 'file',
      path: '/srv/m/.claude-plugin/marketplace.json',
    })
  })
})

describe('reserved marketplace names', () => {
  const local = { source: 'local', path: '/x' } as const
  it('refuses official names outside github.com/anthropics/, and their imitations', () => {
    expect(marketplaceNameProblem('claude-plugins-official', local)).toContain('reserved')
    expect(
      marketplaceNameProblem('claude-plugins-official', {
        source: 'github',
        repo: 'anthropics/claude-plugins-official',
      }),
    ).toBeNull()
    expect(marketplaceNameProblem('claude.code.plugins', local)).toContain('another spelling')
    expect(marketplaceNameProblem('official-claude-plugins', local)).toContain('impersonates')
    expect(marketplaceNameProblem('claude-plugins-official-v2', local)).toContain('impersonates')
  })
  it('refuses names Claude Code uses itself, object members, claudeai-, and bad characters', () => {
    for (const name of ['inline', 'NPM', 'toString', 'claudeai-x', '../escape', 'a b', 'tëst'])
      expect(marketplaceNameProblem(name, local)).not.toBeNull()
    expect(marketplaceNameProblem('acme-tools', local)).toBeNull()
  })
  it('a reserved name is refused at add time', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, { '.claude-plugin/marketplace.json': catalog([], 'claude-code-plugins') })
    const { deps } = registry(upstream)
    await expect(addMarketplace({ source: 'local', path: upstream }, deps)).rejects.toThrow(
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
    expect(await addMarketplace({ source: 'local', path: upstream }, deps)).toEqual({
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
    await addMarketplace({ source: 'file', path: file }, deps)
    const res = await resolveMarketplaceInstall({ plugin: 'good', marketplace: 'acme-tools' }, deps)
    expect(res.dir).toBe(join(deps.root!, 'acme-tools', 'plugins', 'good'))
  })

  it('fails a relative source whose directory does not exist, naming the path', async () => {
    const upstream = join(dir(), 'up')
    writeTree(upstream, {
      '.claude-plugin/marketplace.json': catalog([{ name: 'gone', source: './plugins/gone' }]),
    })
    const { deps } = registry()
    await addMarketplace({ source: 'local', path: upstream }, deps)
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
    await addMarketplace({ source: 'url', url: 'https://example.com/marketplace.json' }, deps)

    await expect(
      resolveMarketplaceInstall({ plugin: 'local-one', marketplace: 'acme-tools' }, deps),
    ).rejects.toThrow('was added from a URL')
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
        { name: 'evil', source: { source: 'url', url: 'https://h/r.git', path: '/etc' } },
      ]),
    })
    const { deps } = registry(join(dir(), 'up'))
    await addMarketplace({ source: 'local', path: upstream }, deps)
    await expect(
      resolveMarketplaceInstall({ plugin: 'evil', marketplace: 'acme-tools' }, deps),
    ).rejects.toThrow('escapes the repository')
  })
})

describe('plugin source kinds', () => {
  it('git-subdir takes owner/repo shorthand; archive and command are recognized', () => {
    const entry = (source: unknown) => ({ name: 'p', source }) as unknown as MarketplaceEntry
    expect(
      resolveEntrySource('/m', entry({ source: 'git-subdir', url: 'o/r', path: 'p' })),
    ).toEqual({ git: { url: 'https://github.com/o/r.git', subdir: 'p' } })
    expect(
      resolveEntrySource(
        '/m',
        entry({ source: 'archive', url: 'https://x.example/p.zip', sha256: 'AB' }),
      ),
    ).toEqual({ archive: { url: 'https://x.example/p.zip', sha256: 'ab' } })
    expect(() =>
      resolveEntrySource('/m', entry({ source: 'archive', url: 'http://x.example/p.zip' })),
    ).toThrow('https://')
    expect(() => resolveEntrySource('/m', entry({ source: 'command', command: 'x' }))).toThrow(
      'does not run',
    )
    expect(resolveEntrySource('/m', entry('.'))).toEqual({ localPath: '/m' })
  })
})

describe('an entry whose source is the marketplace root', () => {
  it('loads only the skills it lists', async () => {
    const plugin = dir()
    writeTree(plugin, {
      'skills/xlsx/SKILL.md': '---\nname: xlsx\ndescription: Sheets\n---\nBody\n',
      'skills/pdf/SKILL.md': '---\nname: pdf\ndescription: PDFs\n---\nBody\n',
    })
    const entry = {
      name: 'document-skills',
      source: './',
      strict: false,
      skills: ['./skills/xlsx'],
    } as unknown as MarketplaceEntry
    await applyEntryManifestOverrides(plugin, entry)
    const loaded = await loadManifest(plugin, 'global', '')
    expect(loaded.error).toBeUndefined()
    expect(loaded.provides.skills).toEqual(['xlsx'])
  })
})
