import { describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import { publishExtensionTrees } from './publish-trees'
import { isApiError } from '../../lib/errors'
import type { PluginCatalogEntry } from './catalog'
import {
  prepareDependenciesForInstall,
  type PreparedDependencyInstall,
} from './dependencies-install'
import type { DiscoveredPlugin } from './discovery'
import { resolveMarketplaceInstall, type MarketplaceRegistryDeps } from './marketplace-registry'
import { readInstallRecords } from './plugin-cache'

/**
 * A marketplace install's dependencies, planned by the kit and published with the parent: each copy
 * as it was fetched, recorded in `installed_plugins.json` so it loads with its entry.
 */
const dir = tempDirPerTest('deps-install-')
const markets = () => join(dir(), 'markets')
const home = () => join(dir(), 'home')

function writeMarketplace(name: string, plugins: Record<string, unknown>[], extra = {}) {
  writeTree(join(markets(), name), {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name,
      owner: { name: 't' },
      plugins,
      ...extra,
    }),
  })
}
const writePlugin = (market: string, manifest: Record<string, unknown>) =>
  writeTree(join(markets(), market, String(manifest.name)), {
    '.claude-plugin/plugin.json': JSON.stringify(manifest),
  })
async function register(names: string[], extra: Record<string, unknown> = {}) {
  const known = Object.fromEntries(
    names.map((name) => [
      name,
      {
        source: { source: 'directory', path: join(markets(), name) },
        installLocation: join(markets(), name),
        lastUpdated: '2026-10-20T10:00:00.000Z',
        ...extra,
      },
    ]),
  )
  await fs.mkdir(markets(), { recursive: true })
  await fs.writeFile(join(markets(), 'known_marketplaces.json'), JSON.stringify(known))
}

const deps = (): MarketplaceRegistryDeps => ({
  root: markets(),
  cloneRepo: () => Promise.reject(new Error('no cloning in this test')),
})

function memoryRepo(rows: Map<string, CapabilitySourceRecord>): CapabilitySourceRepository {
  const record = (userId: string, projectId: string, name: string, source: string) => ({
    id: name,
    userId,
    projectId,
    name,
    config: {},
    source,
    createdAt: '',
    updatedAt: '',
  })
  return {
    upsert: (userId, projectId, name, patch) => {
      const saved = record(userId, projectId, name, patch.source ?? '')
      rows.set(name, saved)
      return Promise.resolve(saved)
    },
    patchConfig: () => Promise.reject(new Error('unused')),
    remove: (_u, _p, name) => Promise.resolve(void rows.delete(name)),
    listForScope: () => Promise.resolve([...rows.values()]),
    get: (_u, _p, name) => Promise.resolve(rows.get(name) ?? null),
  } as CapabilitySourceRepository
}

async function prepare(
  plugin: string,
  opts: { entries?: PluginCatalogEntry[]; projectPath?: string } = {},
) {
  const resolved = await resolveMarketplaceInstall({ plugin, marketplace: 'main' }, deps())
  return prepareDependenciesForInstall({
    resolved,
    registryDeps: deps(),
    entries: opts.entries ?? [],
    scope: opts.projectPath ? 'project' : 'global',
    projectPath: opts.projectPath ?? null,
    installRoot: join(opts.projectPath ?? home(), '.localix', 'plugins'),
    home: home(),
    now: () => '2026-11-11T00:00:00.000Z',
  })
}

/** The publication a host carries out: trees, then the records and the rows in the commit. */
async function commit(
  prepared: PreparedDependencyInstall,
  rows: Map<string, CapabilitySourceRecord>,
) {
  const publication = prepared.publication({ userId: 'u1', projectId: '' })
  await publishExtensionTrees({
    installRoot: join(home(), '.localix', 'plugins'),
    trees: publication.trees,
    commit: async () => {
      for (const claim of publication.claims) await claim()
      await publication.write(memoryRepo(rows))
    },
  })
}

const installed = (name: string, id: string, dependencies: unknown[] = []): PluginCatalogEntry => ({
  plugin: {
    manifest: { name, version: '1.0.0', dependencies },
    scope: 'global',
    projectId: '',
    cachedInstall: { id, version: '1.0.0' },
  } as unknown as DiscoveredPlugin,
  state: undefined,
  enabled: true,
  awaitingConsent: false,
})

describe('prepareDependenciesForInstall', () => {
  it('copies a dependency into the version cache, records it and its row', async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    writePlugin('main', { name: 'parent', dependencies: ['helper'] })
    writePlugin('main', { name: 'helper', version: '1.0.0' })
    await register(['main'])
    const prepared = await prepare('parent')
    expect(prepared.toInstall).toEqual(['helper'])
    const rows = new Map<string, CapabilitySourceRecord>()
    await commit(prepared, rows)
    const record = (await readInstallRecords(home()))['helper@main']
    expect(record).toMatchObject({ version: '1.0.0' })
    expect(await fs.exists(join(record!.installPath, '.claude-plugin/plugin.json'))).toBe(true)
    expect(rows.get('helper')).toMatchObject({ source: 'helper@main' })
  })

  it("an entry's dependencies count with plugin.json's", async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent', dependencies: ['a'] },
      { name: 'a', source: './a' },
      { name: 'b', source: './b' },
    ])
    writePlugin('main', { name: 'parent', dependencies: ['b'] })
    writePlugin('main', { name: 'a' })
    writePlugin('main', { name: 'b' })
    await register(['main'])
    expect((await prepare('parent')).toInstall.sort()).toEqual(['a', 'b'])
  })

  it('refuses before anything is written when a dependency is not listed', async () => {
    writeMarketplace('main', [{ name: 'parent', source: './parent' }])
    writePlugin('main', { name: 'parent', dependencies: ['ghost'] })
    await register(['main'])
    const error = await prepare('parent').catch((e: unknown) => e)
    expect(isApiError(error) && error.code).toBe('plugin_dependency_refused')
    expect(String((error as Error).message)).toContain('"ghost@main" is not installed')
    expect(await fs.exists(home())).toBe(false)
  })

  it('a cycle back to the parent installs the other plugin only', async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    writePlugin('main', { name: 'parent', dependencies: ['helper'] })
    writePlugin('main', { name: 'helper', dependencies: ['parent'] })
    await register(['main'])
    expect((await prepare('parent')).toInstall).toEqual(['helper'])
  })

  it('a dependency installed and on inside its range is met', async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    writePlugin('main', { name: 'parent', dependencies: [{ name: 'helper', version: '^1' }] })
    writePlugin('main', { name: 'helper', version: '1.0.0' })
    await register(['main'])
    const prepared = await prepare('parent', { entries: [installed('helper', 'helper@main')] })
    expect(prepared.toInstall).toEqual([])
  })

  it('a project-scope dependency goes in the project and is recorded for it', async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    writePlugin('main', { name: 'parent', dependencies: ['helper'] })
    writePlugin('main', { name: 'helper', version: '1.0.0' })
    await register(['main'])
    const project = join(dir(), 'repo')
    const prepared = await prepare('parent', { projectPath: project })
    const publication = prepared.publication({ userId: 'u1', projectId: 'p1' })
    expect(publication.trees.map((tree) => [tree.root, tree.name])).toEqual([
      [join(project, '.localix', 'plugins'), 'helper'],
    ])
    for (const claim of publication.claims) await claim()
    expect((await readInstallRecords(home(), project))['helper@main']).toMatchObject({
      installPath: join(project, '.localix', 'plugins', 'helper'),
    })
    expect(await readInstallRecords(home())).toEqual({})
  })

  it('a cross-marketplace dependency needs the root marketplace to allow it', async () => {
    writeMarketplace('other', [{ name: 'helper', source: './helper' }])
    writePlugin('other', { name: 'helper' })
    writeMarketplace('main', [{ name: 'parent', source: './parent' }])
    writePlugin('main', { name: 'parent', dependencies: ['helper@other'] })
    await register(['main', 'other'])
    const prepared = await prepare('parent')
    // Declared in plugin.json and not allowed: left out, the install goes on (the kit's rule).
    expect(prepared.toInstall).toEqual([])
    expect(prepared.warnings.join('\n')).toContain('helper@other')

    writeMarketplace('main', [{ name: 'parent', source: './parent' }], {
      allowCrossMarketplaceDependenciesOn: ['other'],
    })
    expect((await prepare('parent')).toInstall).toEqual(['helper'])
  })

  it('fetches the highest release tag every range admits (the kit picks it)', async () => {
    writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'vault', source: { source: 'github', repo: 'acme/vault' } },
    ])
    writePlugin('main', { name: 'parent', dependencies: [{ name: 'vault', version: '~2.1.0' }] })
    await register(['main'])
    const checkouts: (string | undefined)[] = []
    const tagged: MarketplaceRegistryDeps = {
      ...deps(),
      cloneRepo: (_url, dest, ref) => {
        checkouts.push(ref)
        writeTree(dest, { '.claude-plugin/plugin.json': JSON.stringify({ name: 'vault' }) })
        return Promise.resolve()
      },
      listTags: () =>
        Promise.resolve(['vault--v2.0.0', 'vault--v2.1.0', 'vault--v2.1.3', 'vault--v3.0.0']),
    }
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      tagged,
    )
    const prepared = await prepareDependenciesForInstall({
      resolved,
      registryDeps: tagged,
      entries: [],
      scope: 'global',
      projectPath: null,
      installRoot: join(home(), '.localix', 'plugins'),
      home: home(),
      now: () => '',
    })
    expect(prepared.toInstall).toEqual(['vault'])
    expect(checkouts.at(-1)).toBe('vault--v2.1.3')

    writePlugin('main', { name: 'parent', dependencies: [{ name: 'vault', version: '^4' }] })
    const refused = await prepareDependenciesForInstall({
      resolved,
      registryDeps: tagged,
      entries: [],
      scope: 'global',
      projectPath: null,
      installRoot: join(home(), '.localix', 'plugins'),
      home: home(),
      now: () => '',
    }).catch((e: unknown) => e)
    expect(String(refused)).toContain('has no git tag satisfying')
  })
})
