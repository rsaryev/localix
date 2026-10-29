import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type { Listing } from '@localixai/store'

import { createPluginStoreProvider, type PluginStoreService } from './store-provider'
import type { PluginRecord } from './contracts'
import type { PluginUpdatesResponse } from './contracts-updates'

const dir = tempDirPerTest('plugin-store-provider-')
const actor = { userId: 'u1' }
const OFFICIAL = 'claude-plugins-official'
const COMMUNITY = 'claude-community'

const pg = { source: 'url', url: 'https://github.com/Acme/pg.git' }

function fixture() {
  const root = join(dir(), 'marketplaces')
  writeTree(root, {
    'known.json': JSON.stringify({
      [OFFICIAL]: {
        source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
        installLocation: join(root, OFFICIAL),
        gitCommitSha: 'c1',
        lastUpdated: '2026-10-20T10:00:00.000Z',
        autoUpdate: false,
      },
      [COMMUNITY]: {
        source: { source: 'github', repo: 'anthropics/claude-plugins-community' },
        installLocation: join(root, COMMUNITY),
      },
    }),
    [`${OFFICIAL}/.claude-plugin/marketplace.json`]: JSON.stringify({
      name: OFFICIAL,
      owner: { name: 'Anthropic' },
      metadata: {
        localix: {
          recommended: ['review'],
          featured: ['pg'],
          suits: { pg: { files: ['*.sql'], dependencies: ['pg', 42] } },
          collections: [{ id: 'data', title: 'Work with data', items: ['pg', 'mini-app:ledger'] }],
        },
      },
      plugins: [
        {
          name: 'review',
          displayName: 'Code review',
          source: './plugins/review',
          description: 'Review pull requests',
          author: { name: 'Anthropic' },
          category: 'development',
          tags: ['review', 'git'],
          version: '1.2.0',
          homepage: 'https://review.test',
        },
        { name: 'pg', source: pg, description: 'Postgres tools', category: 'database' },
      ],
    }),
    [`${OFFICIAL}/plugins/review/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'review' }),
    [`${OFFICIAL}/plugins/review/skills/review-pr/SKILL.md`]:
      '---\nname: review-pr\ndescription: Review\n---\nGo',
    [`${OFFICIAL}/plugins/review/commands/review.md`]: '---\ndescription: Review now\n---\nGo',
    [`${COMMUNITY}/.claude-plugin/marketplace.json`]: JSON.stringify({
      name: COMMUNITY,
      owner: { name: 'Anthropic' },
      metadata: {
        localix: {
          recommended: ['pg'],
          collections: [{ id: 'x', title: 'X', items: ['pg'] }],
          suits: { pg: { files: ['*.sql'] } },
        },
      },
      plugins: [{ name: 'pg', source: pg, description: 'Postgres tools' }],
    }),
  })
  const calls: string[] = []
  let installed: PluginRecord[] = []
  let updates: PluginUpdatesResponse = { available: [], jobs: [], lastCheckedAt: null }
  const remote = join(dir(), 'fetched', 'pg')
  writeTree(remote, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'pg', license: 'MIT' }),
    'README.md': '# pg\n\nQuery Postgres.',
    '.mcp.json': JSON.stringify({ mcpServers: { pg: { command: 'npx', args: ['pg-mcp'] } } }),
  })
  let scans = 0
  let release: () => void = () => {}
  const service: PluginStoreService = {
    listPlugins: async () => ({ plugins: installed }),
    install: async (_user, input) => {
      calls.push(`install ${input.source} ${input.projectId ?? 'global'}`)
      await new Promise<void>((resolve) => (release = resolve))
      return {} as PluginRecord
    },
    update: async (_user, input) => {
      calls.push(`update ${input.name}`)
      return {} as PluginRecord
    },
    remove: async (_user, input) =>
      void calls.push(`remove ${input.name} ${input.projectId ?? ''}`),
    setEnabled: async (_user, input) => {
      calls.push(`enable ${input.name} ${input.enabled}`)
      return {} as PluginRecord
    },
    setConfig: async (_user, input) => {
      calls.push(`config ${input.name} ${input.projectId ?? ''} ${JSON.stringify(input.values)}`)
      return {} as PluginRecord
    },
    addMarketplace: async (_user, input) => {
      calls.push(`add ${input.source}`)
      return { name: 'x', count: 0 }
    },
    removeMarketplace: async (_user, input) => {
      calls.push(`remove source ${input.name}`)
      return { uninstalled: [] }
    },
    updateMarketplace: async (_user, input) => {
      calls.push(`update source ${input.name}`)
      return { name: input.name, count: 0, updated: [], manual: [], warnings: [] }
    },
    setMarketplaceAutoUpdate: async (_user, input) =>
      void calls.push(`auto-update ${input.name} ${input.autoUpdate}`),
    refreshMarketplaces: async () => {
      calls.push('refresh')
      return { refreshed: [], updated: [], manual: [], warnings: [] }
    },
    updates: { snapshot: () => updates, subscribe: () => () => {} },
  }
  const provider = createPluginStoreProvider({
    root,
    cacheDir: join(dir(), 'cache'),
    owner: 'u1',
    service,
    fetchEntry: async (ref) => {
      calls.push(`fetch ${ref.plugin}@${ref.marketplace}`)
      return { dir: remote }
    },
    onScan: () => void scans++,
  })
  return {
    provider,
    calls,
    root,
    scans: () => scans,
    release: () => release(),
    install: (records: PluginRecord[]) => (installed = records),
    offer: (next: PluginUpdatesResponse) => (updates = next),
  }
}

const byId = (listings: Listing[], id: string) => listings.find((l) => l.ref.id === id)!

describe('plugins in the Store', () => {
  test('a marketplace entry is a listing with every field its marketplace gives', async () => {
    const { provider } = fixture()
    const { listings, problems } = await provider.listings(actor)
    expect(problems).toEqual([])
    expect(byId(listings, `review@${OFFICIAL}`)).toMatchObject({
      ref: { kind: 'plugin', id: `review@${OFFICIAL}` },
      name: 'review',
      displayName: 'Code review',
      summary: 'Review pull requests',
      category: 'development',
      tags: ['review', 'git'],
      version: '1.2.0',
      homepage: 'https://review.test',
      publisher: { name: 'Anthropic', verified: true },
      source: { id: OFFICIAL, trust: 'official', weight: 0.7 },
      contents: { skill: 1, command: 1 },
      runsCode: false,
      installs: [],
    })
    expect(byId(listings, `pg@${COMMUNITY}`)).toMatchObject({
      contents: 'unknown',
      runsCode: 'unknown',
      publisher: { verified: false },
      source: { id: COMMUNITY, trust: 'community', weight: 0.35 },
    })
  })

  test('an editorial marketplace’s picks for Discover; a community one picks nothing', async () => {
    const { provider } = fixture()
    const { listings } = await provider.listings(actor)
    expect(byId(listings, `review@${OFFICIAL}`)).toMatchObject({
      recommended: true,
      featured: false,
    })
    expect(byId(listings, `pg@${OFFICIAL}`)).toMatchObject({ featured: true })
    expect(byId(listings, `pg@${COMMUNITY}`)).toMatchObject({ recommended: false })
    expect(await provider.editorial!()).toEqual([
      {
        source: OFFICIAL,
        collections: [
          {
            id: 'data',
            title: 'Work with data',
            style: 'row',
            items: [
              { kind: 'plugin', id: `pg@${OFFICIAL}` },
              { kind: 'mini-app', id: 'ledger' },
            ],
          },
        ],
      },
    ])
  })

  test('an editorial marketplace says what its entries are for; a community one says nothing', async () => {
    const { provider } = fixture()
    const { listings } = await provider.listings(actor)
    expect(byId(listings, `pg@${OFFICIAL}`).suits).toEqual({
      files: ['*.sql'],
      dependencies: ['pg'],
    })
    expect(byId(listings, `review@${OFFICIAL}`).suits).toBeUndefined()
    expect(byId(listings, `pg@${COMMUNITY}`).suits).toBeUndefined()
  })

  test('two marketplaces listing one repository name one origin', async () => {
    const { provider } = fixture()
    const { listings } = await provider.listings(actor)
    expect(byId(listings, `pg@${OFFICIAL}`).origin).toBe('git:github.com/acme/pg')
    expect(byId(listings, `pg@${COMMUNITY}`).origin).toBe('git:github.com/acme/pg')
    expect(byId(listings, `review@${OFFICIAL}`).origin).toBe(
      'git:github.com/anthropics/claude-plugins-official#plugins/review',
    )
  })

  test('a checkout is scanned once per revision', async () => {
    const { provider, scans } = fixture()
    await provider.listings(actor)
    await provider.listings(actor)
    expect(scans()).toBe(1)
  })

  test('an install shows its scope, version, switch, offered update and settings', async () => {
    const { provider, install, offer } = fixture()
    install([
      {
        name: 'review',
        version: '1.1.0',
        description: '',
        projectId: '',
        scope: 'global',
        dir: '/x',
        source: `review@${OFFICIAL}`,
        enabled: true,
        config: [],
      } as unknown as PluginRecord,
    ])
    offer({
      available: [
        {
          id: `review@${OFFICIAL}`,
          name: 'review',
          marketplace: OFFICIAL,
          from: '1.1.0',
          to: '1.2.0',
        },
      ],
      jobs: [],
      lastCheckedAt: null,
    })
    const review = byId((await provider.listings(actor)).listings, `review@${OFFICIAL}`)
    expect(review.installs).toEqual([
      { scope: 'user', version: '1.1.0', enabled: true, updateTo: '1.2.0' },
    ])
    expect(review.configurable).toBeUndefined()
  })

  describe('settings', () => {
    const installed = (config: PluginRecord['config'], scope: 'global' | 'project' = 'global') =>
      ({
        name: 'review',
        version: '1.1.0',
        description: '',
        projectId: scope === 'project' ? 'p1' : '',
        scope,
        dir: '/x',
        source: `review@${OFFICIAL}`,
        enabled: true,
        config,
      }) as PluginRecord
    const field = (
      over: Partial<PluginRecord['config'][number]>,
    ): PluginRecord['config'][number] => ({
      key: 'url',
      type: 'string',
      description: 'Where it runs',
      required: false,
      secret: false,
      value: 'https://a.test',
      isSet: true,
      ...over,
    })

    test('an install that declares options is configurable, one that declares none is not', async () => {
      const { provider, install } = fixture()
      install([installed([field({})])])
      expect(byId((await provider.listings(actor)).listings, `review@${OFFICIAL}`)).toMatchObject({
        configurable: true,
      })
      install([installed([])])
      expect(
        byId((await provider.listings(actor)).listings, `review@${OFFICIAL}`).configurable,
      ).toBeUndefined()
    })

    test('the options come typed, per scope the plugin is installed in', async () => {
      const { provider, install } = fixture()
      install([
        installed([field({ key: 'tags', multiple: true, value: '["a"]' })]),
        installed([field({ value: 'https://p.test' })], 'project'),
      ])
      const id = `review@${OFFICIAL}`
      const user = await provider.config!(id, 'user', actor)
      expect(user).toMatchObject({
        scope: 'user',
        scopes: ['user', 'project'],
        values: { tags: ['a'] },
      })
      const project = await provider.config!(id, 'project', { ...actor, projectId: 'p1' })
      expect(project?.values).toEqual({ url: 'https://p.test' })
      expect(await provider.config!(`pg@${OFFICIAL}`, 'user', actor)).toBeNull()
    })

    test('saving sends the values the way the plugin keeps them, to the install of that scope', async () => {
      const { provider, calls } = fixture()
      await provider.setConfig!(
        `review@${OFFICIAL}`,
        'project',
        { tags: ['a', 'b'], n: 2 },
        { ...actor, projectId: 'p1' },
      )
      expect(calls).toContain('config review p1 {"tags":"[\\"a\\",\\"b\\"]","n":2}')
    })
  })

  test('a remote plugin’s page answers at once, fetches it once behind, then says what it adds and runs', async () => {
    const { provider, calls } = fixture()
    let heard = 0
    provider.subscribe(() => void heard++)
    // The page opens on what the marketplace says; the fetch does not hold it up.
    const first = await provider.detail(`pg@${COMMUNITY}`, actor)
    expect(first).toMatchObject({ contents: 'unknown', components: [], readme: null })
    await provider.settled()
    expect(heard).toBe(1)
    const detail = await provider.detail(`pg@${COMMUNITY}`, actor)
    expect(calls).toEqual([`fetch pg@${COMMUNITY}`])
    expect(detail.readme).toContain('Query Postgres')
    expect(detail.components).toEqual([{ kind: 'mcp-server', name: 'pg' }])
    const plan = await provider.plan(`pg@${COMMUNITY}`, 'user', actor)
    expect(calls).toHaveLength(1)
    expect(plan).toMatchObject({
      runs: [{ kind: 'mcp-server', name: 'pg', command: 'npx pg-mcp' }],
      needsConsent: true,
    })
  })

  test('a text-only plugin from a trusted marketplace installs without a yes', async () => {
    const { provider } = fixture()
    expect((await provider.plan(`review@${OFFICIAL}`, 'user', actor)).needsConsent).toBe(false)
  })

  test('install is queued: refused without the yes a plan asks for, its job shown until done', async () => {
    const { provider, calls, release } = fixture()
    await expect(
      provider.install(`pg@${COMMUNITY}`, 'user', { plan: false }, actor),
    ).rejects.toMatchObject({ status: 409 })
    await provider.install(`pg@${COMMUNITY}`, 'user', { plan: true }, actor)
    expect(calls).toContain(`install pg@${COMMUNITY} global`)
    const busy = byId((await provider.listings(actor)).listings, `pg@${COMMUNITY}`)
    expect(busy.job).toMatchObject({ action: 'install', phase: 'downloading' })
    release()
    await provider.settled()
    const done = byId((await provider.listings(actor)).listings, `pg@${COMMUNITY}`)
    expect(done.job).toMatchObject({ phase: 'done' })
  })

  test('a project install goes to the open project, and needs one', async () => {
    const { provider, calls, release } = fixture()
    await expect(
      provider.install(`review@${OFFICIAL}`, 'project', { plan: true }, actor),
    ).rejects.toMatchObject({ status: 400 })
    await provider.install(
      `review@${OFFICIAL}`,
      'project',
      { plan: true },
      {
        ...actor,
        projectId: 'p1',
      },
    )
    release()
    await provider.settled()
    expect(calls).toContain(`install review@${OFFICIAL} p1`)
  })

  test('remove, switch and sources go through the plugin service', async () => {
    const { provider, calls } = fixture()
    await provider.remove(`review@${OFFICIAL}`, 'user', actor)
    await provider.setEnabled!(`review@${OFFICIAL}`, 'user', false, actor)
    await provider.addSource!('acme/plugins')
    await provider.removeSource!(COMMUNITY)
    expect(calls).toEqual([
      'remove review ',
      'enable review false',
      'add acme/plugins',
      `remove source ${COMMUNITY}`,
    ])
    expect(await provider.sources()).toEqual([
      expect.objectContaining({ id: OFFICIAL, count: 2, trust: 'official', builtIn: false }),
      expect.objectContaining({ id: COMMUNITY, count: 1, trust: 'community' }),
    ])
  })

  test('a source says when it was read, its auto-update, and is read again or switched alone', async () => {
    const { provider, calls } = fixture()
    const [official, community] = await provider.sources()
    expect(official).toMatchObject({ syncedAt: '2026-10-20T10:00:00.000Z', autoUpdate: false })
    expect(official!.problem).toBeUndefined()
    expect(community!.autoUpdate).toBe(false)
    await provider.refreshSource!(OFFICIAL)
    await provider.setSourceAutoUpdate!(OFFICIAL, true)
    expect(calls).toEqual([`update source ${OFFICIAL}`, `auto-update ${OFFICIAL} true`])
  })

  test('a marketplace that cannot be read is still a source, saying why', async () => {
    const { provider, root } = fixture()
    const known = JSON.parse(await Bun.file(join(root, 'known.json')).text())
    known.gone = {
      source: { source: 'github', repo: 'acme/gone' },
      installLocation: join(root, 'gone'),
    }
    await Bun.write(join(root, 'known.json'), JSON.stringify(known))
    const gone = (await provider.sources()).find((source) => source.id === 'gone')
    expect(gone).toMatchObject({ count: 0, label: 'gone' })
    expect(gone?.problem).toContain('could not be read')
  })

  test('the open project’s own installs, by listing id', async () => {
    const { provider, install } = fixture()
    install([
      {
        name: 'review',
        version: '1.2.0',
        description: '',
        projectId: 'p1',
        scope: 'project',
        dir: '/x',
        source: `review@${OFFICIAL}`,
        enabled: false,
      } as PluginRecord,
    ])
    expect(await provider.projectInstalls!({ ...actor, projectId: 'p1' })).toEqual([
      {
        id: `review@${OFFICIAL}`,
        installs: [{ scope: 'project', version: '1.2.0', enabled: false }],
      },
    ])
    expect(await provider.projectInstalls!({ ...actor, projectId: 'p2' })).toEqual([])
  })
})
