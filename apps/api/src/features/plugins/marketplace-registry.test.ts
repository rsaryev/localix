import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { CLAUDE_CODE_MARKETPLACE, CLAUDE_CODE_MARKETPLACE_HINT } from './claude-code-marketplace'

import {
  addMarketplace,
  listMarketplaces,
  parseMarketplaceInput,
  parseMarketplaceRef,
  marketplacesRoot,
  readKnownMarketplaces,
  removeMarketplace,
  resolveBareInstall,
  resolveEntrySource,
  resolveMarketplaceInstall,
  updateMarketplace,
  LOCALIX_MARKETPLACE,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { stubFetch, fetchUrl } from '../../testing/fetch-stub'
import { homedir } from 'node:os'

describe('marketplacesRoot', () => {
  it('resolves <base>/.localix/marketplaces, defaulting base to the home dir', () => {
    expect(marketplacesRoot('/tmp/x')).toBe(join('/tmp/x', '.localix', 'marketplaces'))
    expect(marketplacesRoot()).toBe(join(homedir(), '.localix', 'marketplaces'))
  })
})

describe('parseMarketplaceInput', () => {
  it('hints at /plugin install for a plugin@marketplace reference, keeping SSH git URLs', () => {
    expect(parseMarketplaceInput('cool@acme')).toEqual({
      error:
        '"cool@acme" looks like a plugin@marketplace reference; install it with /plugin install cool@acme',
    })
    expect(parseMarketplaceInput('git@github.com:acme/repo.git')).toEqual({
      source: 'git',
      url: 'git@github.com:acme/repo.git',
    })
  })

  it('parses owner/repo as github', () => {
    expect(parseMarketplaceInput('nextlevelbuilder/ui-ux-pro-max-skill')).toEqual({
      source: 'github',
      repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
    })
  })
  it('parses an https git url', () => {
    expect(parseMarketplaceInput('https://github.com/a/b.git')).toEqual({
      source: 'git',
      url: 'https://github.com/a/b.git',
    })
  })
  it('parses an ssh url with a ref', () => {
    expect(parseMarketplaceInput('git@github.com:a/b.git#v2')).toEqual({
      source: 'git',
      url: 'git@github.com:a/b.git',
      ref: 'v2',
    })
  })
  it('parses an absolute path as local', () => {
    expect(parseMarketplaceInput('/tmp/mkt')).toEqual({ source: 'local', path: '/tmp/mkt' })
  })
  it('errors on garbage', () => {
    expect(parseMarketplaceInput('not a marketplace!!')).toHaveProperty('error')
  })
  it('parses the npm: shorthand, with and without a version spec', () => {
    expect(parseMarketplaceInput('npm:acme-marketplace')).toEqual({
      source: 'npm',
      package: 'acme-marketplace',
    })
    expect(parseMarketplaceInput('npm:@scope/mkt@^2.0.0')).toEqual({
      source: 'npm',
      package: '@scope/mkt',
      version: '^2.0.0',
    })
  })
  it('accepts a CC-spec npm source object (extraKnownMarketplaces shape)', () => {
    expect(
      parseMarketplaceInput({
        source: 'npm',
        package: '@org/mkt',
        version: '^1.0.0',
        registry: 'https://r.example',
      }),
    ).toEqual({
      source: 'npm',
      package: '@org/mkt',
      version: '^1.0.0',
      registry: 'https://r.example',
    })
  })
  it('errors on an invalid npm package name (string and object forms)', () => {
    expect(parseMarketplaceInput('npm:../evil')).toHaveProperty('error')
    expect(
      parseMarketplaceInput({ source: 'npm', package: 'https://evil.example/x' }),
    ).toHaveProperty('error')
    expect(parseMarketplaceInput({ source: 'npm' })).toHaveProperty('error')
  })
  it('errors on a non-npm source object', () => {
    expect(parseMarketplaceInput({ source: 'github', repo: 'a/b' })).toHaveProperty('error')
  })
})

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

describe('resolveEntrySource', () => {
  it('resolves a relative source inside the marketplace dir', () => {
    expect(resolveEntrySource('/mkt', { name: 'x', source: './plugins/x' })).toEqual({
      localPath: '/mkt/plugins/x',
    })
  })
  it('rejects a .. escape', () => {
    expect(() => resolveEntrySource('/mkt', { name: 'x', source: '../escape' })).toThrow()
  })
  it('returns git coordinates for an object git-subdir source', () => {
    const r = resolveEntrySource('/mkt', {
      name: 'x',
      source: {
        source: 'git-subdir',
        url: 'https://h/r.git',
        path: 'plugins/x',
        ref: 'v1',
      } as never,
    })
    expect(r).toEqual({ git: { url: 'https://h/r.git', subdir: 'plugins/x', ref: 'v1' } })
  })
  it('prefers a sha pin over a ref for git sources', () => {
    const r = resolveEntrySource('/mkt', {
      name: 'x',
      source: { url: 'https://h/r.git', ref: 'main', sha: 'deadbeef' } as never,
    })
    expect(r).toEqual({ git: { url: 'https://h/r.git', ref: 'deadbeef' } })
  })
  it('resolves a relative source under the catalog pluginRoot', () => {
    expect(
      resolveEntrySource('/mkt', { name: 'x', source: './x' }, { pluginRoot: './plugins' }),
    ).toEqual({ localPath: '/mkt/plugins/x' })
  })
  it('a pluginRoot cannot let an entry escape the marketplace root', () => {
    expect(() =>
      resolveEntrySource('/mkt', { name: 'x', source: '../../etc' }, { pluginRoot: './plugins' }),
    ).toThrow()
  })
  it('resolves an npm source to registry coordinates', () => {
    const r = resolveEntrySource('/mkt', {
      name: 'x',
      source: { source: 'npm', package: '@scope/pkg', version: '^2.0.0' } as never,
    })
    expect(r).toEqual({ npm: { package: '@scope/pkg', version: '^2.0.0' } })
  })
  it('rejects an npm source with an invalid package name', () => {
    expect(() =>
      resolveEntrySource('/mkt', {
        name: 'x',
        source: { source: 'npm', package: 'https://evil.example/x' } as never,
      }),
    ).toThrow(/package/)
  })

  // Source-variant coverage over representative entries from the official
  // official public marketplace schema.
  describe('real marketplace.json source variants', () => {
    it('github {repo, commit, sha} — sha wins, repo → https url', () => {
      // entry: fullstory
      const r = resolveEntrySource('/mkt', {
        name: 'fullstory',
        source: {
          source: 'github',
          repo: 'fullstorydev/fullstory-skills',
          commit: '1ec5865e',
          sha: 'b20614e2',
        } as never,
      })
      expect(r).toEqual({
        git: { url: 'https://github.com/fullstorydev/fullstory-skills.git', ref: 'b20614e2' },
      })
    })
    it('github {repo, commit} with no sha — commit is the checkout target', () => {
      const r = resolveEntrySource('/mkt', {
        name: 'gh-commit-only',
        source: { source: 'github', repo: 'owner/repo', commit: 'abc123' } as never,
      })
      expect(r).toEqual({ git: { url: 'https://github.com/owner/repo.git', ref: 'abc123' } })
    })
    it('url {url, path, sha} — subdir + sha pin (atomic-agents)', () => {
      const r = resolveEntrySource('/mkt', {
        name: 'atomic-agents',
        source: {
          source: 'url',
          url: 'https://github.com/BrainBlend-AI/atomic-agents.git',
          path: 'plugin/atomic-agents',
          sha: '94220182',
        } as never,
      })
      expect(r).toEqual({
        git: {
          url: 'https://github.com/BrainBlend-AI/atomic-agents.git',
          subdir: 'plugin/atomic-agents',
          ref: '94220182',
        },
      })
    })
    it('url {url, sha} — whole-repo, sha pin (agentforce-adlc)', () => {
      const r = resolveEntrySource('/mkt', {
        name: 'agentforce-adlc',
        source: {
          source: 'url',
          url: 'https://github.com/SalesforceAIResearch/agentforce-adlc.git',
          sha: 'f17012bd',
        } as never,
      })
      expect(r).toEqual({
        git: {
          url: 'https://github.com/SalesforceAIResearch/agentforce-adlc.git',
          ref: 'f17012bd',
        },
      })
    })
    it('git-subdir {url, path, ref, sha} — sha wins over ref (42crunch)', () => {
      const r = resolveEntrySource('/mkt', {
        name: '42crunch-api-security-testing',
        source: {
          source: 'git-subdir',
          url: 'https://github.com/42Crunch-AI/agent-plugins.git',
          path: 'plugins/api-security-testing',
          ref: 'v1.5.5',
          sha: '0f325999',
        } as never,
      })
      expect(r).toEqual({
        git: {
          url: 'https://github.com/42Crunch-AI/agent-plugins.git',
          subdir: 'plugins/api-security-testing',
          ref: '0f325999',
        },
      })
    })
  })
})

describe('marketplace registry (add / list / resolve / remove)', () => {
  let root: string
  let localixDir: string
  let upstream: string
  let deps: MarketplaceRegistryDeps

  beforeEach(async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'mkt-'))
    root = join(base, 'marketplaces')
    // Built-in localix catalog with one ./plugin entry.
    localixDir = join(base, 'bundled')
    await fs.mkdir(join(localixDir, '.localix-plugin'), { recursive: true })
    await fs.mkdir(join(localixDir, 'web'), { recursive: true })
    await fs.writeFile(
      join(localixDir, 'web', 'plugin.json'),
      JSON.stringify({ name: 'web', version: '1.0.0', description: 'web tools' }),
    )
    await fs.writeFile(
      join(localixDir, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'localix',
        owner: { name: 'Localix' },
        plugins: [{ name: 'web', source: './web' }],
      }),
    )
    // A fake "upstream" marketplace repo our cloneRepo stub copies from.
    upstream = join(base, 'upstream')
    await fs.mkdir(join(upstream, '.localix-plugin'), { recursive: true })
    await fs.mkdir(join(upstream, 'plugins', 'cool'), { recursive: true })
    await fs.writeFile(
      join(upstream, 'plugins', 'cool', 'plugin.json'),
      JSON.stringify({ name: 'cool', version: '1.0.0', description: 'cool' }),
    )
    await fs.writeFile(
      join(upstream, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: 'acme',
        plugins: [{ name: 'cool', source: './plugins/cool' }],
      }),
    )
    deps = {
      root,
      localixDir,
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
    const res = await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    expect(res).toEqual({ name: 'acme', count: 1 })
  })

  it('resolves plugin@owner/repo against the source a marketplace was added from', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    const res = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme/repo' }, deps)
    expect(res.marketplace).toBe('acme')
    expect(res.entry.name).toBe('cool')
  })

  it('refuses a Claude Code-only marketplace with the individual-install hint', async () => {
    await fs.rm(join(upstream, '.localix-plugin'), { recursive: true })
    await fs.mkdir(dirname(join(upstream, CLAUDE_CODE_MARKETPLACE)), { recursive: true })
    await fs.writeFile(
      join(upstream, CLAUDE_CODE_MARKETPLACE),
      JSON.stringify({ name: 'cc', owner: { name: 'o' }, plugins: [] }),
    )
    expect(addMarketplace({ source: 'github', repo: 'o/cc' }, deps)).rejects.toThrow(
      CLAUDE_CODE_MARKETPLACE_HINT,
    )
  })

  it('restores the previous marketplace when activation fails', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    await fs.writeFile(
      join(upstream, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: 'acme',
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
      await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    } catch (error) {
      activationError = error
    } finally {
      rename.mockRestore()
    }
    expect(activationError).toBeInstanceOf(Error)
    expect((activationError as Error).message).toContain('simulated activation failure')

    expect(
      JSON.parse(await fs.readFile(join(installDir, '.localix-plugin/marketplace.json'), 'utf8')),
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
      const manifestPath = join(dir, '.localix-plugin', 'marketplace.json')
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
          await new Promise((resolve) => setTimeout(resolve, 10))
          await fs.cp(url.includes('/first') ? first : second, dest, { recursive: true })
        } finally {
          activeClones -= 1
        }
      },
    }

    await Promise.all([
      addMarketplace({ source: 'github', repo: 'org/first' }, concurrentDeps),
      addMarketplace({ source: 'github', repo: 'org/second' }, concurrentDeps),
    ])

    expect(peakClones).toBe(1)
    expect(Object.keys(await readKnownMarketplaces(root)).sort()).toEqual(['first', 'second'])
  })

  it('list shows the built-in localix first, then registered ones', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    const list = await listMarketplaces(deps)
    expect(list[0]).toEqual({
      name: LOCALIX_MARKETPLACE,
      builtin: true,
      count: 1,
      plugins: [{ name: 'web' }],
    })
    expect(list.find((m) => m.name === 'acme')).toEqual({
      name: 'acme',
      builtin: false,
      count: 1,
      plugins: [{ name: 'cool' }],
    })
  })

  it('listing rows carry typed per-entry relevance + description (round-trip)', async () => {
    const relevance = {
      filePatterns: ['**/*.tf'],
      directoryNames: ['terraform'],
      keywords: ['infra'],
    }
    await fs.writeFile(
      join(upstream, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'acme',
        owner: 'acme',
        plugins: [{ name: 'cool', source: './plugins/cool', description: 'cool infra', relevance }],
      }),
    )
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    const list = await listMarketplaces(deps)
    expect(list.find((m) => m.name === 'acme')?.plugins).toEqual([
      { name: 'cool', description: 'cool infra', relevance },
    ])
    // …and the resolved entry exposes the same typed block for installers.
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.entry.relevance).toEqual(relevance)
  })

  it('resolves plugin@localix against the built-in catalog (priority)', async () => {
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'web', marketplace: LOCALIX_MARKETPLACE },
      deps,
    )
    expect(resolved.dir).toBe(join(localixDir, 'web'))
    expect(resolved.entry.name).toBe('web')
  })

  it('resolves plugin@marketplace from a registered marketplace', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    const resolved = await resolveMarketplaceInstall({ plugin: 'cool', marketplace: 'acme' }, deps)
    expect(resolved.dir).toBe(join(root, 'acme', 'plugins', 'cool'))
    expect(resolved.entry.name).toBe('cool')
  })

  it('refuses to override or remove the built-in localix marketplace', () => {
    expect(removeMarketplace(LOCALIX_MARKETPLACE, deps)).rejects.toThrow()
  })

  it('remove deletes a registered marketplace', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    await removeMarketplace('acme', deps)
    const list = await listMarketplaces(deps)
    expect(list.find((m) => m.name === 'acme')).toBeUndefined()
  })

  it('errors resolving an unknown marketplace', () => {
    expect(resolveMarketplaceInstall({ plugin: 'x', marketplace: 'nope' }, deps)).rejects.toThrow(
      'Unknown marketplace',
    )
  })

  it('resolves a bare plugin name across registered marketplaces (no @marketplace)', async () => {
    await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
    const resolved = await resolveBareInstall('cool', deps)
    expect(resolved.dir).toBe(join(root, 'acme', 'plugins', 'cool'))
    expect(resolved.entry.name).toBe('cool')
  })

  it('a bare name in the built-in localix catalog resolves there (priority)', async () => {
    const resolved = await resolveBareInstall('web', deps)
    expect(resolved.dir).toBe(join(localixDir, 'web'))
    expect(resolved.entry.name).toBe('web')
  })

  it('errors on a bare name found in no marketplace', () => {
    expect(resolveBareInstall('does-not-exist', deps)).rejects.toThrow('registered marketplace')
  })

  it('resolveMarketplaceInstall exposes entry.defaultEnabled=true when set in the catalog', async () => {
    // Rewrite the localix catalog with a defaultEnabled:true entry.
    await fs.writeFile(
      join(localixDir, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'localix',
        owner: { name: 'Localix' },
        plugins: [{ name: 'web', source: './web', defaultEnabled: true }],
      }),
    )
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'web', marketplace: LOCALIX_MARKETPLACE },
      deps,
    )
    expect(resolved.entry.defaultEnabled).toBe(true)
  })

  it('resolveMarketplaceInstall exposes entry.defaultEnabled=false when set in the catalog', async () => {
    await fs.writeFile(
      join(localixDir, '.localix-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'localix',
        owner: { name: 'Localix' },
        plugins: [{ name: 'web', source: './web', defaultEnabled: false }],
      }),
    )
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'web', marketplace: LOCALIX_MARKETPLACE },
      deps,
    )
    expect(resolved.entry.defaultEnabled).toBe(false)
  })

  it('resolveMarketplaceInstall returns entry.defaultEnabled=undefined when not set', async () => {
    // The fixture catalog has no defaultEnabled on the web entry.
    const resolved = await resolveMarketplaceInstall(
      { plugin: 'web', marketplace: LOCALIX_MARKETPLACE },
      deps,
    )
    expect(resolved.entry.defaultEnabled).toBeUndefined()
  })

  describe('renames (CC 2.1.193+)', () => {
    /** Rewrite the acme upstream with a renames map, then register it. */
    async function addAcmeWithRenames(renames: Record<string, string | null>): Promise<void> {
      await fs.writeFile(
        join(upstream, '.localix-plugin', 'marketplace.json'),
        JSON.stringify({
          name: 'acme',
          owner: 'acme',
          plugins: [{ name: 'cool', source: './plugins/cool' }],
          renames,
        }),
      )
      await addMarketplace({ source: 'github', repo: 'acme/repo' }, deps)
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

  describe('npm marketplace sources (whole-marketplace from a package)', () => {
    const realFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = realFetch
    })

    /** Build a real npm-shaped tarball whose root carries `.localix-plugin/marketplace.json`. */
    async function makeMarketTarball(pluginNames: string[]): Promise<Uint8Array> {
      const work = await fs.mkdtemp(join(tmpdir(), 'npm-mkt-'))
      try {
        const pkg = join(work, 'package')
        await fs.mkdir(join(pkg, '.localix-plugin'), { recursive: true })
        const plugins = []
        for (const name of pluginNames) {
          await fs.mkdir(join(pkg, 'plugins', name), { recursive: true })
          await fs.writeFile(
            join(pkg, 'plugins', name, 'plugin.json'),
            JSON.stringify({ name, version: '1.0.0', description: name }),
          )
          plugins.push({ name, source: `./plugins/${name}` })
        }
        await fs.writeFile(
          join(pkg, '.localix-plugin', 'marketplace.json'),
          JSON.stringify({ name: 'npmmkt', owner: 'acme', plugins }),
        )
        const tgz = join(work, 'm.tgz')
        await Bun.spawn(['tar', '-czf', tgz, '-C', work, 'package']).exited
        return new Uint8Array(await fs.readFile(tgz))
      } finally {
        await fs.rm(work, { recursive: true, force: true })
      }
    }

    /** Stub the npm registry: one packument, per-version tarballs (no integrity → skip verify). */
    function stubNpmRegistry(byVersion: Record<string, Uint8Array>, latest: string): void {
      globalThis.fetch = stubFetch(async (input) => {
        const url = fetchUrl(input)
        const m = url.match(/\/t-([\d.]+)\.tgz$/)
        if (m) return new Response(byVersion[m[1] as string]!.slice().buffer as ArrayBuffer)
        return Response.json({
          'dist-tags': { latest },
          versions: Object.fromEntries(
            Object.keys(byVersion).map((v) => [v, { dist: { tarball: `https://x/t-${v}.tgz` } }]),
          ),
        })
      })
    }

    it('add registers a marketplace fetched from npm (materialized like a git one)', async () => {
      stubNpmRegistry({ '1.0.0': await makeMarketTarball(['cool']) }, '1.0.0')
      const source = parseMarketplaceInput('npm:acme-marketplace@^1.0.0')
      if ('error' in source) throw new Error(source.error)
      const res = await addMarketplace(source, deps)
      expect(res).toEqual({ name: 'npmmkt', count: 1 })
      // Same ~/.localix/marketplaces/<name>/ layout + known.json record as git sources.
      const known = await readKnownMarketplaces(root)
      expect(known['npmmkt']).toEqual({
        source: { source: 'npm', package: 'acme-marketplace', version: '^1.0.0' },
        installLocation: join(root, 'npmmkt'),
      })
      const resolved = await resolveMarketplaceInstall(
        { plugin: 'cool', marketplace: 'npmmkt' },
        deps,
      )
      expect(resolved.dir).toBe(join(root, 'npmmkt', 'plugins', 'cool'))
    })

    it('update re-fetches the latest version satisfying the recorded range', async () => {
      stubNpmRegistry({ '1.0.0': await makeMarketTarball(['cool']) }, '1.0.0')
      await addMarketplace({ source: 'npm', package: 'acme-marketplace', version: '^1.0.0' }, deps)
      // A newer 1.2.0 (two plugins) is published; ^1.0.0 now resolves to it.
      stubNpmRegistry(
        {
          '1.0.0': await makeMarketTarball(['cool']),
          '1.2.0': await makeMarketTarball(['cool', 'cooler']),
        },
        '1.2.0',
      )
      const res = await updateMarketplace('npmmkt', deps)
      expect(res).toEqual({ name: 'npmmkt', count: 2 })
      const list = await listMarketplaces(deps)
      expect(list.find((m) => m.name === 'npmmkt')?.plugins.map((p) => p.name)).toEqual([
        'cool',
        'cooler',
      ])
    })

    it('update of an unknown marketplace errors; built-in localix cannot be updated', () => {
      expect(updateMarketplace('nope', deps)).rejects.toThrow('Unknown marketplace')
      expect(updateMarketplace(LOCALIX_MARKETPLACE, deps)).rejects.toThrow('cannot be updated')
    })

    it('add surfaces the npm path typed errors (registry 404 → plugin_npm_fetch_failed)', async () => {
      globalThis.fetch = stubFetch(async () => new Response('nope', { status: 404 }))
      expect(addMarketplace({ source: 'npm', package: 'does-not-exist' }, deps)).rejects.toThrow(
        /HTTP 404/,
      )
    })
  })
})
