import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  addMarketplace,
  listMarketplaces,
  parseMarketplaceRef,
  removeMarketplace,
  resolveBareInstall,
  resolveMarketplaceInstall,
  updateMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { readKnownMarketplaces } from './kit'

const CATALOG = '.claude-plugin/marketplace.json'
const gh = (repo: string) => ({ kind: 'github', repo, path: CATALOG }) as const

describe('parseMarketplaceRef', () => {
  it('splits plugin@marketplace', () => {
    expect(parseMarketplaceRef('ui-ux-pro-max@ui-ux-pro-max-skill')).toEqual({
      plugin: 'ui-ux-pro-max',
      marketplace: 'ui-ux-pro-max-skill',
    })
  })
  it('returns null without an @', () => {
    expect(parseMarketplaceRef('just-a-name')).toBeNull()
  })
})

describe('marketplace registry (add / list / resolve / remove)', () => {
  let root: string
  let upstream: string
  let deps: MarketplaceRegistryDeps

  beforeEach(async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'mkt-'))
    root = join(base, 'marketplaces')
    // A fake "upstream" marketplace repo our cloneRepo stub copies from.
    upstream = join(base, 'upstream')
    await fs.mkdir(join(upstream, '.claude-plugin'), { recursive: true })
    await fs.mkdir(join(upstream, 'plugins', 'cool', '.claude-plugin'), { recursive: true })
    await fs.writeFile(
      join(upstream, 'plugins', 'cool', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cool', version: '1.0.0', description: 'cool' }),
    )
    await fs.writeFile(
      join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: { name: 'acme' },
        plugins: [{ name: 'cool', source: './plugins/cool' }],
      }),
    )
    deps = {
      root,
      now: () => '2026-01-01T00:00:00.000Z',
      cloneRepo: async (_url, dest) => {
        await fs.cp(upstream, dest, { recursive: true })
      },
    }
  })

  afterEach(async () => {
    await fs.rm(join(root, '..'), { recursive: true, force: true }).catch(() => {})
  })

  it('add registers a marketplace from a github source via the clone stub', async () => {
    const res = await addMarketplace(gh('acme/repo'), deps)
    expect(res).toEqual({ name: 'acme', count: 1 })
  })

  it('records the marketplace in known_marketplaces.json, as Claude Code reads it', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    expect(await fs.readdir(root)).toContain('known_marketplaces.json')
    expect(await readKnownMarketplaces(root)).toEqual({
      acme: {
        source: gh('acme/repo'),
        installLocation: join(root, 'acme'),
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    })
  })

  it('registers a catalog file where it is, its plugins read from its folder', async () => {
    const file = join(upstream, CATALOG)
    expect(await addMarketplace({ kind: 'file', path: file }, deps)).toEqual({
      name: 'acme',
      count: 1,
    })
    expect((await readKnownMarketplaces(root)).acme?.installLocation).toBe(file)
    expect(await fs.readdir(root)).not.toContain('acme')
    const res = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(res.dir).toBe(join(upstream, 'plugins', 'cool'))
  })

  it('refuses a source the organization blocks before fetching anything', async () => {
    const managed = join(root, '..', 'managed')
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(
      join(managed, 'managed-settings.json'),
      JSON.stringify({ blockedMarketplaces: [{ source: 'github', repo: 'evil/plugins' }] }),
    )
    let cloned = false
    const blocked = addMarketplace(gh('evil/plugins'), {
      ...deps,
      managedSettingsDir: managed,
      cloneRepo: async () => {
        cloned = true
      },
    })
    await expect(blocked).rejects.toThrow('is blocked by enterprise policy')
    expect(cloned).toBe(false)
  })

  it('resolves plugin@owner/repo against the source a marketplace was added from', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    const res = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme/repo' }, deps)
    expect(res.marketplace).toBe('acme')
    expect(res.entry.name).toBe('cool')
  })

  it('registers a Claude Code-only marketplace (.claude-plugin/marketplace.json)', async () => {
    await fs.rm(join(upstream, '.claude-plugin'), { recursive: true })
    await fs.mkdir(dirname(join(upstream, CATALOG)), { recursive: true })
    await fs.writeFile(
      join(upstream, CATALOG),
      JSON.stringify({
        name: 'cc',
        owner: { name: 'o' },
        plugins: [{ name: 'cool', source: './plugins/cool' }],
      }),
    )
    expect(await addMarketplace(gh('o/cc'), deps)).toEqual({
      name: 'cc',
      count: 1,
    })
    const res = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'cc' }, deps)
    expect(res.dir).toBe(join(root, 'cc', 'plugins', 'cool'))
  })

  it('restores the previous marketplace when activation fails', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    await fs.writeFile(
      join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: { name: 'acme' },
        plugins: [{ name: 'cool', source: './plugins/cool', description: 'updated' }],
      }),
    )
    const installDir = join(root, 'acme')
    const realRename = fs.rename.bind(fs)
    const rename = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === installDir && typeof from === 'string' && from.includes('.staging-')) {
        throw Object.assign(new Error('simulated activation failure'), { code: 'EIO' })
      }
      return realRename(from, to)
    })

    let activationError: unknown
    try {
      await addMarketplace(gh('acme/repo'), deps)
    } catch (error) {
      activationError = error
    } finally {
      rename.mockRestore()
    }
    expect(activationError).toBeInstanceOf(Error)
    expect((activationError as Error).message).toContain('simulated activation failure')

    expect(
      JSON.parse(await fs.readFile(join(installDir, '.claude-plugin/marketplace.json'), 'utf8')),
    ).toMatchObject({ plugins: [{ name: 'cool' }] })
    expect((await readKnownMarketplaces(root)).acme?.installLocation).toBe(installDir)
  })

  it('serializes marketplace mutations that share a registry root', async () => {
    const first = join(root, '..', 'first-upstream')
    const second = join(root, '..', 'second-upstream')
    await fs.cp(upstream, first, { recursive: true })
    await fs.cp(upstream, second, { recursive: true })
    for (const [dir, name] of [
      [first, 'first'],
      [second, 'second'],
    ] as const) {
      const manifestPath = join(dir, '.claude-plugin', 'marketplace.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
        string,
        unknown
      >
      await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, name }))
    }
    let activeClones = 0
    let peakClones = 0
    const concurrentDeps: MarketplaceRegistryDeps = {
      ...deps,
      cloneRepo: async (url, dest) => {
        activeClones += 1
        peakClones = Math.max(peakClones, activeClones)
        try {
          await new Promise((resolve) => setTimeout(resolve, 0))
          await fs.cp(url.includes('/first') ? first : second, dest, { recursive: true })
        } finally {
          activeClones -= 1
        }
      },
    }

    await Promise.all([
      addMarketplace(gh('org/first'), concurrentDeps),
      addMarketplace(gh('org/second'), concurrentDeps),
    ])

    expect(peakClones).toBe(1)
    expect(Object.keys(await readKnownMarketplaces(root)).sort()).toEqual(['first', 'second'])
  })

  it('list shows the registered marketplaces, and nothing built in', async () => {
    expect(await listMarketplaces(deps)).toEqual([])
    await addMarketplace(gh('acme/repo'), deps)
    expect(await listMarketplaces(deps)).toEqual([
      { name: 'acme', count: 1, plugins: [{ name: 'cool' }] },
    ])
  })

  it("listing rows carry each entry's description", async () => {
    await fs.writeFile(
      join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: { name: 'acme' },
        plugins: [{ name: 'cool', source: './plugins/cool', description: 'cool infra' }],
      }),
    )
    await addMarketplace(gh('acme/repo'), deps)
    const list = await listMarketplaces(deps)
    expect(list.find((m) => m.name === 'acme')?.plugins).toEqual([
      { name: 'cool', description: 'cool infra' },
    ])
  })

  it('resolves plugin@marketplace from a registered marketplace', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.dir).toBe(join(root, 'acme', 'plugins', 'cool'))
    expect(resolved.entry.name).toBe('cool')
  })

  it('remove deletes a registered marketplace', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    await removeMarketplace('acme', deps)
    const list = await listMarketplaces(deps)
    expect(list.find((m) => m.name === 'acme')).toBeUndefined()
  })

  it('update of an unknown marketplace errors', () => {
    expect(updateMarketplace('nope', deps)).rejects.toThrow('Unknown marketplace')
  })

  it('errors resolving an unknown marketplace', () => {
    expect(resolveMarketplaceInstall({ plugin: 'x', marketplace: 'nope' }, deps)).rejects.toThrow(
      'Unknown marketplace',
    )
  })

  it('resolves a bare plugin name across registered marketplaces (no @marketplace)', async () => {
    await addMarketplace(gh('acme/repo'), deps)
    const resolved = await resolveBareInstall('cool', deps)
    expect(resolved.dir).toBe(join(root, 'acme', 'plugins', 'cool'))
    expect(resolved.entry.name).toBe('cool')
  })

  it('errors on a bare name found in no marketplace', () => {
    expect(resolveBareInstall('does-not-exist', deps)).rejects.toThrow('registered marketplace')
  })

  /** Register acme with its one entry carrying `extra`. */
  async function addAcmeEntry(extra: Record<string, unknown>): Promise<void> {
    await fs.writeFile(
      join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: { name: 'acme' },
        plugins: [{ name: 'cool', source: './plugins/cool', ...extra }],
      }),
    )
    await addMarketplace(gh('acme/repo'), deps)
  }

  it('resolveMarketplaceInstall exposes entry.defaultEnabled=true when set in the catalog', async () => {
    await addAcmeEntry({ defaultEnabled: true })
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.entry.defaultEnabled).toBe(true)
  })

  it('resolveMarketplaceInstall exposes entry.defaultEnabled=false when set in the catalog', async () => {
    await addAcmeEntry({ defaultEnabled: false })
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.entry.defaultEnabled).toBe(false)
  })

  it('resolveMarketplaceInstall returns entry.defaultEnabled=undefined when not set', async () => {
    await addAcmeEntry({})
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.entry.defaultEnabled).toBeUndefined()
  })

  describe('renames (CC 2.1.193+)', () => {
    /** Rewrite the acme upstream with a renames map, then register it. */
    async function addAcmeWithRenames(renames: Record<string, string | null>): Promise<void> {
      await fs.writeFile(
        join(upstream, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({
          name: 'acme',
          owner: { name: 'acme' },
          plugins: [{ name: 'cool', source: './plugins/cool' }],
          renames,
        }),
      )
      await addMarketplace(gh('acme/repo'), deps)
    }

    it('an old name resolves to the renamed entry, with renamedFrom set', async () => {
      await addAcmeWithRenames({ 'old-cool': 'cool' })
      const resolved = await resolveMarketplaceInstall(
        { plugin: 'old-cool', marketplace: 'acme' },
        deps,
      )
      expect(resolved.entry.name).toBe('cool')
      expect(resolved.dir).toBe(join(root, 'acme', 'plugins', 'cool'))
      expect(resolved.renamedFrom).toBe('old-cool')
    })

    it('a name still present in the catalog resolves directly (renamedFrom unset)', async () => {
      await addAcmeWithRenames({ 'old-cool': 'cool' })
      const resolved = await resolveMarketplaceInstall(
        { plugin: 'cool', marketplace: 'acme' },
        deps,
      )
      expect(resolved.entry.name).toBe('cool')
      expect(resolved.renamedFrom).toBeUndefined()
    })

    it('a null-mapped name errors with "removed from marketplace"', async () => {
      await addAcmeWithRenames({ gone: null })
      expect(
        resolveMarketplaceInstall({ plugin: 'gone', marketplace: 'acme' }, deps),
      ).rejects.toThrow('removed from marketplace')
    })

    it('a bare old name is found via the rename key and resolves to the new entry', async () => {
      await addAcmeWithRenames({ 'old-cool': 'cool' })
      const resolved = await resolveBareInstall('old-cool', deps)
      expect(resolved.entry.name).toBe('cool')
      expect(resolved.renamedFrom).toBe('old-cool')
    })

    it('a bare null-mapped name surfaces the removed error (not "no marketplace")', async () => {
      await addAcmeWithRenames({ gone: null })
      expect(resolveBareInstall('gone', deps)).rejects.toThrow('removed from marketplace')
    })
  })
})
