import { capabilityStores } from '../../bootstrap/capability-stores'
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { z } from 'zod'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

import {
  dependencyVersionWarning,
  listDependents,
  normalizePluginDependencies,
  resolveDependencyPlan,
  type DependencyResolverDeps,
  type ResolvedDependencyStep,
} from './dependencies'
import { cascadeEnableDependencies } from './dependencies-enable'
import {
  prepareDependenciesForInstall,
  type PreparedDependencyInstall,
} from './dependencies-install'
import { publishExtensionTrees } from '../ext/publish-trees'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { createContributionStore } from '../ext/contribution-store'
import { publishPluginInstallation } from './publish-installation'
import { withPluginSource } from './install-helpers'
import { resolveMarketplaceInstall, type MarketplaceRegistryDeps } from './marketplace-registry'
import { isApiError } from '../../lib/errors'
import type { DiscoveredPlugin } from './discovery'

// ---------- test doubles ------------------------------------------------------

function fakePlugin(
  over: Partial<DiscoveredPlugin> & {
    name: string
    dependencies?: Array<string | { name: string; version?: string }>
    hasNativeTools?: boolean
  },
): DiscoveredPlugin {
  const { name, dependencies, hasNativeTools, ...rest } = over
  return {
    manifest: { name, version: '1.0.0', description: '', dependencies } as never,
    dir: `/plugins/${name}`,
    scope: 'global',
    projectId: '',
    entrypoints: {} as never,
    provides: {
      hasNativeTools: hasNativeTools ?? false,
      tools: [],
      skills: [],
      mcpServers: [],
      commands: [],
    },
    commands: [],
    agents: [],
    bundled: false,
    ...rest,
  }
}

function step(name: string, marketplace: string, extra?: Partial<ResolvedDependencyStep>) {
  return {
    name,
    marketplace,
    dir: `/mkt/${marketplace}/${name}`,
    entry: { name, source: `./${name}` },
    dependencies: [],
    ...extra,
  } satisfies ResolvedDependencyStep
}

/** Fake planner I/O over an in-memory catalog map: marketplace → step-by-name. */
function fakeResolver(opts: {
  installed?: Map<string, string | undefined>
  markets?: Record<string, Record<string, ResolvedDependencyStep>>
  allow?: Record<string, string[]>
}): DependencyResolverDeps {
  const markets = opts.markets ?? {}
  return {
    installed: opts.installed ?? new Map(),
    findMarketplacesWithPlugin: async (name) =>
      Object.keys(markets).filter((m) => name in markets[m]!),
    resolveFromMarketplace: async (name, marketplace) => markets[marketplace]![name]!,
    getAllowList: async (marketplace) => opts.allow?.[marketplace] ?? [],
  }
}

// ---------- normalize + version -----------------------------------------------

describe('normalizePluginDependencies', () => {
  it('parses the CC union (string | {name, version?}), deduped, invalid dropped', () => {
    expect(
      normalizePluginDependencies([
        'helper-lib',
        { name: 'pinned', version: '^2.0.0' },
        { name: 'helper-lib', version: '9.9.9' }, // duplicate — first wins
        '', // invalid
        { version: '1.0.0' } as never, // no name
        42 as never,
      ]),
    ).toEqual([{ name: 'helper-lib' }, { name: 'pinned', version: '^2.0.0' }])
  })
  it('returns [] for absent/non-array input', () => {
    expect(normalizePluginDependencies(undefined)).toEqual([])
    expect(normalizePluginDependencies({} as never)).toEqual([])
  })
})

describe('dependencyVersionWarning', () => {
  it('is silent when the range is satisfied or unknown', () => {
    expect(dependencyVersionWarning({ name: 'a', version: '^1.0.0' }, '1.4.2', 'x')).toBeNull()
    expect(dependencyVersionWarning({ name: 'a' }, '1.0.0', 'x')).toBeNull()
    expect(dependencyVersionWarning({ name: 'a', version: '^1.0.0' }, undefined, 'x')).toBeNull()
  })
  it('warns (never blocks) naming the exact versions on a mismatch', () => {
    const w = dependencyVersionWarning(
      { name: 'a', version: '^2.0.0' },
      '1.4.2',
      'the installed plugin',
    )
    expect(w).toContain('"^2.0.0"')
    expect(w).toContain('"1.4.2"')
  })
})

// ---------- plan resolution -----------------------------------------------------

describe('resolveDependencyPlan', () => {
  it('resolves a dependency from the parent marketplace first', async () => {
    const plan = await resolveDependencyPlan(
      [{ name: 'helper' }],
      'main',
      fakeResolver({
        markets: {
          main: { helper: step('helper', 'main') },
          other: { helper: step('helper', 'other') },
        },
      }),
    )
    expect(plan.steps.map((s) => [s.name, s.marketplace])).toEqual([['helper', 'main']])
  })

  it('treats already-installed plugins as satisfied (advisory version check only)', async () => {
    const plan = await resolveDependencyPlan(
      [{ name: 'helper', version: '^2.0.0' }],
      'main',
      fakeResolver({ installed: new Map([['helper', '1.0.0']]) }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.warnings).toHaveLength(1)
    expect(plan.warnings[0]).toContain('"1.0.0"')
  })

  it('allows a cross-marketplace dependency listed in allowCrossMarketplaceDependenciesOn', async () => {
    const plan = await resolveDependencyPlan(
      [{ name: 'helper' }],
      'main',
      fakeResolver({
        markets: { main: {}, other: { helper: step('helper', 'other') } },
        allow: { main: ['other'] },
      }),
    )
    expect(plan.steps.map((s) => s.marketplace)).toEqual(['other'])
  })

  it('blocks a cross-marketplace dependency NOT in the allow list, naming the restriction', async () => {
    const err = await resolveDependencyPlan(
      [{ name: 'helper' }],
      'main',
      fakeResolver({
        markets: { main: {}, other: { helper: step('helper', 'other') } },
        allow: { main: ['trusted-only'] },
      }),
    ).catch((e: unknown) => e)
    expect(isApiError(err) && err.code).toBe('plugin_dependency_blocked')
    expect((err as Error).message).toContain('allowCrossMarketplaceDependenciesOn')
    expect((err as Error).message).toContain('"other"')
  })

  it('fails atomically (typed error, no steps) on a missing dependency', async () => {
    const err = await resolveDependencyPlan(
      [{ name: 'ghost' }],
      'main',
      fakeResolver({ markets: { main: {} } }),
    ).catch((e: unknown) => e)
    expect(isApiError(err) && err.code).toBe('plugin_dependency_missing')
  })

  it('resolves transitively and terminates on cycles (a → b → a)', async () => {
    const a = step('a', 'main', { dependencies: [{ name: 'b' }] })
    const b = step('b', 'main', { dependencies: [{ name: 'a' }] })
    const plan = await resolveDependencyPlan(
      [{ name: 'a' }],
      'main',
      fakeResolver({ markets: { main: { a, b } } }),
    )
    expect(plan.steps.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('warns on a version-pinned marketplace dependency whose entry version mismatches', async () => {
    const plan = await resolveDependencyPlan(
      [{ name: 'helper', version: '^3.0.0' }],
      'main',
      fakeResolver({ markets: { main: { helper: step('helper', 'main', { version: '2.1.0' }) } } }),
    )
    expect(plan.steps).toHaveLength(1) // still installs — advisory only
    expect(plan.warnings[0]).toContain('"^3.0.0"')
    expect(plan.warnings[0]).toContain('"2.1.0"')
  })
})

// ---------- enable cascade ------------------------------------------------------

describe('cascadeEnableDependencies', () => {
  const run = async (root: DiscoveredPlugin, discovered: DiscoveredPlugin[], on: Set<string>) => {
    const enabled: string[] = []
    const result = await cascadeEnableDependencies(root, {
      discovered,
      isEnabled: (p) => on.has(p.manifest.name),
      enable: async (p) => {
        enabled.push(p.manifest.name)
      },
    })
    return { result, enabled }
  }

  it('enables installed-but-disabled code-free dependencies', async () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['lib'] })
    const lib = fakePlugin({ name: 'lib' })
    const { result, enabled } = await run(root, [root, lib], new Set(['parent']))
    expect(enabled).toEqual(['lib'])
    expect(result).toMatchObject({
      enabled: ['lib'],
      manualRequired: [],
      missing: [],
      warnings: [],
    })
  })

  it('NEVER auto-enables a non-bundled code-bearing dependency — reports it instead', async () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['native-dep', 'lib'] })
    const native = fakePlugin({ name: 'native-dep', hasNativeTools: true })
    const lib = fakePlugin({ name: 'lib' })
    const { result, enabled } = await run(root, [root, native, lib], new Set(['parent']))
    expect(enabled).toEqual(['lib'])
    expect(result.manualRequired).toEqual(['native-dep'])
    expect(result.warnings.join(' ')).toContain('native-dep')
    expect(result.warnings.join(' ')).toContain('manually')
  })

  it('auto-enables a BUNDLED code-bearing dependency (inside the trust boundary)', async () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['bundled-native'] })
    const dep = fakePlugin({ name: 'bundled-native', hasNativeTools: true, bundled: true })
    const { enabled } = await run(root, [root, dep], new Set(['parent']))
    expect(enabled).toEqual(['bundled-native'])
  })

  it('is cycle-safe (a ↔ b) and cascades transitively', async () => {
    const a = fakePlugin({ name: 'a', dependencies: ['b'] })
    const b = fakePlugin({ name: 'b', dependencies: ['a'] })
    const { enabled } = await run(a, [a, b], new Set())
    expect(enabled).toEqual(['b'])
  })

  it('reports missing (not-installed) dependencies without throwing', async () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['ghost'] })
    const { result } = await run(root, [root], new Set(['parent']))
    expect(result.missing).toEqual(['ghost'])
    expect(result.warnings.join(' ')).toContain('ghost')
  })
})

// ---------- reverse lookup ------------------------------------------------------

describe('listDependents', () => {
  it('names installed plugins that declare a dependency on the given one', () => {
    const a = fakePlugin({ name: 'a', dependencies: ['lib', { name: 'other' }] })
    const b = fakePlugin({ name: 'b', dependencies: [{ name: 'lib', version: '^1.0.0' }] })
    const c = fakePlugin({ name: 'c' })
    expect(listDependents('lib', [a, b, c])).toEqual(['a', 'b'])
    expect(listDependents('nope', [a, b, c])).toEqual([])
  })
})

// ---------- install prepare/commit (fs) ------------------------------------------

describe('prepareDependenciesForInstall', () => {
  let root: string
  let installRoot: string
  let deps: MarketplaceRegistryDeps
  let rows: Map<string, CapabilitySourceRecord>
  const repo = (): CapabilitySourceRepository => ({
    async upsert(userId, projectId, name, patch) {
      const rec = {
        id: name,
        userId,
        projectId,
        name,
        config: {},
        source: patch.source ?? '',
        createdAt: '',
        updatedAt: '',
      }
      rows.set(name, rec)
      return rec
    },
    async patchConfig(userId, projectId, name, patch) {
      const current = rows.get(name)
      const rec = {
        id: current?.id ?? name,
        userId,
        projectId,
        name,
        config: { ...current?.config, ...patch },
        source: current?.source ?? '',
        createdAt: current?.createdAt ?? '',
        updatedAt: '',
      }
      rows.set(name, rec)
      return rec
    },
    async remove(_u, _p, name) {
      rows.delete(name)
    },
    listForScope: async () => [],
    get: async () => null,
  })

  const writeMarketplace = async (
    name: string,
    plugins: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
  ) => {
    const dir = join(root, name)
    await fs.mkdir(join(dir, '.localix-plugin'), { recursive: true })
    await fs.writeFile(
      join(dir, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({ name, owner: { name: 't' }, plugins, ...extra }),
    )
    return dir
  }
  const writePlugin = async (marketDir: string, manifest: Record<string, unknown>) => {
    const dir = join(marketDir, manifest.name as string)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest))
  }
  const registerKnown = async (names: string[]) => {
    const known = Object.fromEntries(
      names.map((n) => [
        n,
        { source: { source: 'local', path: join(root, n) }, installLocation: join(root, n) },
      ]),
    )
    await fs.writeFile(join(root, 'known.json'), JSON.stringify(known))
  }

  beforeEach(async () => {
    root = join(tmpdir(), `deps-test-${randomUUID()}`)
    installRoot = join(root, 'installed')
    await fs.mkdir(installRoot, { recursive: true })
    rows = new Map()
    deps = {
      cloneRepo: async () => {
        throw new Error('no cloning in this test')
      },
      root,
      localixDir: join(root, 'no-such-bundled-dir'),
    }
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const ops = (repository = repo()) => ({
    installRoot,
    scope: 'global' as const,
    projectId: '',
    userId: 'u1',
    transaction: async (operation: (repo: CapabilitySourceRepository) => Promise<void>) => {
      const previous = new Map(rows)
      try {
        await operation(repository)
      } catch (error) {
        rows = previous
        throw error
      }
    },
  })

  // Exercise the dependency plan using a minimal host. Production composes these writes
  // with parent metadata, typed contributions and policy in publishPluginInstallation.
  const commit = async (prepared: PreparedDependencyInstall, operation: ReturnType<typeof ops>) => {
    const publication = prepared.publication(operation)
    await publishExtensionTrees({
      installRoot: operation.installRoot,
      trees: publication.trees,
      commit: () =>
        operation.transaction(async (repository) => {
          await publication.write(repository)
        }),
    })
    return { installed: prepared.toInstall }
  }

  it('plans + commits a same-marketplace dependency (installed DISABLED)', async () => {
    const mkt = await writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    await writePlugin(mkt, { name: 'parent', dependencies: ['helper'] })
    await writePlugin(mkt, { name: 'helper', version: '1.0.0' })
    await registerKnown(['main'])

    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const prepared = await prepareDependenciesForInstall(resolved, deps, [])
    expect(prepared.toInstall).toEqual(['helper'])

    const { installed } = await commit(prepared, ops())
    expect(installed).toEqual(['helper'])
    expect(await fs.exists(join(installRoot, 'helper', 'plugin.json'))).toBe(true)
    // The row records provenance only. A freshly installed dependency writes NO
    // availability rule: it is left to the trust gate until the parent's enable cascade
    // reaches it, which is what keeps an install from being consent to run.
    expect(rows.get('helper')).toMatchObject({ source: 'helper@main' })
  })

  it('fails BEFORE anything is written when a dependency is missing', async () => {
    const mkt = await writeMarketplace('main', [{ name: 'parent', source: './parent' }])
    await writePlugin(mkt, { name: 'parent', dependencies: ['ghost'] })
    await registerKnown(['main'])

    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const err = await prepareDependenciesForInstall(resolved, deps, []).catch((e: unknown) => e)
    expect(isApiError(err) && err.code).toBe('plugin_dependency_missing')
    expect(await fs.readdir(installRoot)).toEqual([]) // nothing written
    expect(rows.size).toBe(0)
  })

  it('a dependency cycle back to the parent never schedules the parent tree twice', async () => {
    const mkt = await writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    await writePlugin(mkt, { name: 'parent', version: '2.0.0', dependencies: ['helper'] })
    await writePlugin(mkt, { name: 'helper', dependencies: ['parent'] })
    await registerKnown(['main'])
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const prepared = await prepareDependenciesForInstall(resolved, deps, [])
    expect(prepared.toInstall).toEqual(['helper'])
    expect(await commit(prepared, ops())).toEqual({ installed: ['helper'] })
  })

  it('a rejected state write removes the new tree without deleting an existing source record', async () => {
    const mkt = await writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    await writePlugin(mkt, { name: 'parent', dependencies: ['helper'] })
    await writePlugin(mkt, { name: 'helper', version: '1.0.0' })
    await registerKnown(['main'])
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const prepared = await prepareDependenciesForInstall(resolved, deps, [])
    const repository = repo()
    const operation = ops(repository)
    const previous = await repository.upsert('u1', '', 'helper', { source: 'previous-source' })
    repository.upsert = async () => {
      expect(await fs.exists(join(installRoot, 'helper', 'plugin.json'))).toBe(true)
      throw new Error('state write rejected')
    }
    await expect(commit(prepared, operation)).rejects.toThrow('state write rejected')
    expect(await fs.readdir(installRoot)).toEqual([])
    expect(rows.get('helper')).toEqual(previous)
  })

  it('enforces allowCrossMarketplaceDependenciesOn across marketplaces', async () => {
    const other = await writeMarketplace('other', [{ name: 'helper', source: './helper' }])
    await writePlugin(other, { name: 'helper' })

    // Blocked: main does not allow "other".
    let mkt = await writeMarketplace('main', [{ name: 'parent', source: './parent' }])
    await writePlugin(mkt, { name: 'parent', dependencies: ['helper'] })
    await registerKnown(['main', 'other'])
    let resolved = await resolveMarketplaceInstall({ plugin: 'parent', marketplace: 'main' }, deps)
    const err = await prepareDependenciesForInstall(resolved, deps, []).catch((e: unknown) => e)
    expect(isApiError(err) && err.code).toBe('plugin_dependency_blocked')

    // Allowed: main lists "other" in allowCrossMarketplaceDependenciesOn.
    mkt = await writeMarketplace('main', [{ name: 'parent', source: './parent' }], {
      allowCrossMarketplaceDependenciesOn: ['other'],
    })
    await writePlugin(mkt, { name: 'parent', dependencies: ['helper'] })
    resolved = await resolveMarketplaceInstall({ plugin: 'parent', marketplace: 'main' }, deps)
    const prepared = await prepareDependenciesForInstall(resolved, deps, [])
    expect(prepared.plan.steps.map((s) => s.marketplace)).toEqual(['other'])
    await commit(prepared, ops())
    expect(rows.get('helper')).toMatchObject({ source: 'helper@other' })
  })

  it('a failure on the last dependency rolls back the entire database transaction and file batch', async () => {
    const mkt = await writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'a', source: './a' },
      { name: 'b', source: './b' },
    ])
    await writePlugin(mkt, { name: 'parent', dependencies: ['a', 'b'] })
    await writePlugin(mkt, { name: 'a' })
    await writePlugin(mkt, { name: 'b' })
    await registerKnown(['main'])
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const prepared = await prepareDependenciesForInstall(resolved, deps, [])
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const sources = createCapabilitySourceRepository(db, 'plugin')
      const previous = await sources.upsert('u1', '', 'a', {
        source: 'previous',
        config: { retained: true },
      })
      await sql`CREATE TRIGGER reject_last_dependency BEFORE INSERT ON capability_source
        WHEN NEW.name = 'b' BEGIN SELECT RAISE(ABORT, 'last dependency rejected'); END`.execute(db)
      const operation = {
        installRoot,
        scope: 'global' as const,
        projectId: '',
        userId: 'u1',
        transaction: (work: (repo: CapabilitySourceRepository) => Promise<void>) =>
          db
            .transaction()
            .execute((transaction) =>
              work(createCapabilitySourceRepository(transaction, 'plugin')),
            ),
      }
      await expect(commit(prepared, operation)).rejects.toThrow('last dependency rejected')
      expect(await fs.readdir(installRoot)).toEqual([])
      expect(await sources.listForScope('u1', '')).toEqual([previous])

      await sql`DROP TRIGGER reject_last_dependency`.execute(db)
      expect(await commit(prepared, operation)).toEqual({ installed: ['a', 'b'] })
      expect(await fs.readdir(installRoot)).toEqual(['a', 'b'])
      expect(await sources.get('u1', '', 'a')).toMatchObject({
        id: previous.id,
        source: 'a@main',
        config: { retained: true },
      })
      expect(await sources.get('u1', '', 'b')).toMatchObject({ source: 'b@main' })
    } finally {
      await db.destroy()
    }
  })

  it('skips dependencies already installed and surfaces the semver mismatch as a warning', async () => {
    const mkt = await writeMarketplace('main', [{ name: 'parent', source: './parent' }])
    await writePlugin(mkt, {
      name: 'parent',
      dependencies: [{ name: 'helper', version: '^2.0.0' }],
    })
    await registerKnown(['main'])

    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const installedHelper = fakePlugin({ name: 'helper' })
    installedHelper.rawManifest = { name: 'helper', version: '1.0.0' }
    const prepared = await prepareDependenciesForInstall(resolved, deps, [installedHelper])
    expect(prepared.toInstall).toEqual([])
    expect(prepared.warnings.join(' ')).toContain('"^2.0.0"')
    expect(prepared.warnings.join(' ')).toContain('"1.0.0"')
  })

  it('parent and dependency contributions share the installation transaction', async () => {
    const mkt = await writeMarketplace('main', [
      { name: 'parent', source: './parent' },
      { name: 'helper', source: './helper' },
    ])
    for (const name of ['parent', 'helper']) {
      await writePlugin(mkt, {
        name,
        ...(name === 'parent' ? { dependencies: ['helper'] } : {}),
        contributions: [{ kind: 'fixture', key: name, value: { label: name } }],
      })
    }
    await registerKnown(['main'])
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'parent', marketplace: 'main' },
      deps,
    )
    const dependencies = await prepareDependenciesForInstall(resolved, deps, [])
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const contributionKinds = createContributionKindRegistry()
      contributionKinds.register('fixture', z.strictObject({ label: z.string() }))
      const sources = createCapabilitySourceRepository(db, 'plugin')
      const store = createContributionStore(db, contributionKinds)
      const publish = () =>
        withPluginSource({ source: resolved.dir, installRoot }, (parent) =>
          publishPluginInstallation({
            db,
            stores: capabilityStores,
            contributionKinds,
            userId: 'u1',
            projectId: '',
            scope: 'global',
            installRoot,
            parent,
            source: 'parent@main',
            replace: false,
            enable: false,
            now: () => 'test-time',
            dependencies,
            prepare: async () => {},
            discover: async () => [],
          }),
        )
      await sql`CREATE TRIGGER reject_parent_contribution BEFORE INSERT ON extension_contribution
        WHEN NEW.contribution_key = 'parent' BEGIN SELECT RAISE(ABORT, 'parent contribution rejected'); END`.execute(
        db,
      )
      await expect(publish()).rejects.toThrow('parent contribution rejected')
      expect(await sources.listForScope('u1', '')).toEqual([])
      expect(await fs.readdir(installRoot)).toEqual([])
      await sql`DROP TRIGGER reject_parent_contribution`.execute(db)
      await publish()
      for (const name of ['parent', 'helper']) {
        const source = await sources.get('u1', '', name)
        expect(source).not.toBeNull()
        expect(await store.getCurrent('u1', source!.id)).toMatchObject({
          revision: 1,
          contributions: [{ kind: 'fixture', key: name, value: { label: name } }],
        })
      }
    } finally {
      await db.destroy()
    }
  })
})
