import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { hostedMiniAppCatalog, type CatalogEntry } from '../../testing/mini-app-catalog'
import { createMiniAppStore } from './store'
import type { MiniAppConfigField } from './contracts'
import { createMiniAppStoreProvider } from './store-provider'

const root = tempDirPerTest('mini-app-store-provider-')
const actor = { userId: 'u1' }
const ADA = 'https://ada.test/mini-app-catalog.json'

function setup(opts: { verified?: boolean; editorial?: unknown } = {}) {
  const catalog = hostedMiniAppCatalog([], { editorial: opts.editorial })
  /** Offer an app in the catalog; what a catalog says is read when the store next asks. */
  const offer = (name: string, extra: Partial<CatalogEntry> = {}) =>
    void catalog.apps.push({ name, verified: opts.verified, ...extra })
  const store = createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => [{ kind: 'catalog', url: catalog.url, vouches: true }],
    onInstalled: async () => {},
    fetchImpl: catalog.fetchImpl,
  })
  const calls: string[] = []
  const enabled = new Map<string, boolean>()
  const configs = new Map<string, MiniAppConfigField[]>()
  const own: Record<string, unknown>[] = []
  const catalogs = [{ url: catalog.url, builtIn: true }]
  const provider = createMiniAppStoreProvider({
    store,
    catalogs: {
      list: async () => catalogs,
      add: async (url) => void calls.push(`add ${url}`),
      remove: async (url) => void calls.push(`remove ${url}`),
      preview: async (url) => ({
        url,
        publishers: ['Ada'],
        apps: 3,
        icons: [],
        verified: false,
        added: false,
      }),
    },
    apps: {
      list: async () => ({
        miniApps: [
          ...[...enabled].map(([name, on]) => ({
            name,
            enabled: on,
            config: configs.get(name) ?? [],
          })),
          ...(own as never[]),
        ],
      }),
      setConfig: async (_userId, { name, values }) =>
        void calls.push(`config ${name} ${JSON.stringify(values)}`),
      setEnabled: async (_userId, { name, enabled: on }) => void calls.push(`enable ${name} ${on}`),
      remove: async (_userId, { name }) => void calls.push(`remove ${name}`),
    },
  })
  return { catalog, offer, store, provider, calls, enabled, catalogs, configs, own }
}

describe('the mini apps in the Store', () => {
  test('an offer is a listing: what it is, where it comes from and what is inside', async () => {
    const { catalog, offer, provider } = setup()
    offer('atlas', {
      displayName: 'Atlas',
      category: 'games',
      tags: ['board-game'],
      surfaces: ['agent', 'workbench'],
      commands: ['play', 'hint'],
      featured: true,
    })
    offer('clock', { surfaces: ['workbench'] })

    const { listings, problems } = await provider.listings(actor)
    expect(problems).toEqual([])
    const [atlas, clock] = listings
    expect(atlas).toMatchObject({
      ref: { kind: 'mini-app', id: 'atlas' },
      name: 'atlas',
      displayName: 'Atlas',
      summary: 'atlas app',
      category: 'games',
      tags: ['board-game'],
      publisher: { name: 'Localix', verified: true },
      source: { id: catalog.url, label: 'Localix' },
      version: '1.0.0',
      contents: { screen: 1, 'agent-tool': 1, backend: 1, command: 2 },
      runsCode: true,
      featured: true,
      recommended: false,
      installs: [],
    })
    expect(atlas!.components).toEqual([
      { kind: 'screen', name: 'Atlas', description: 'A screen of its own' },
      { kind: 'agent-tool', name: 'Agent tools', description: 'Tools for the agent' },
      { kind: 'backend', name: 'Atlas', description: 'Runs on this computer' },
      { kind: 'command', name: '/atlas:play' },
      { kind: 'command', name: '/atlas:hint' },
    ])
    expect(clock).toMatchObject({ displayName: 'clock', contents: { screen: 1 }, runsCode: false })
  })

  test('Localix’s own catalog is trusted and editorial; one the person added is community', async () => {
    const { offer, provider, catalogs } = setup()
    offer('atlas', { featured: true })
    const [own] = (await provider.listings(actor)).listings
    expect(own!.source).toMatchObject({ trust: 'localix', weight: 1 })
    expect(own!.origin).toBe('catalog:atlas')
    expect(own!.featured).toBe(true)

    catalogs[0]!.builtIn = false
    const [added] = (await provider.listings(actor)).listings
    expect(added!.source).toMatchObject({ trust: 'community', weight: 0.35 })
    // Its picks do not reach Discover: only an editorial source's do.
    expect(added!.featured).toBe(false)
  })

  test('Localix’s picks for Discover: and collections', async () => {
    const { catalog, offer, provider, catalogs } = setup({
      editorial: {
        collections: [
          {
            id: 'play',
            title: 'Play with the agent',
            items: ['atlas', 'compass', 'plugin:games@localix'],
          },
        ],
      },
    })
    offer('atlas')
    offer('compass')
    expect(await provider.editorial!()).toEqual([
      {
        source: catalog.url,
        collections: [
          {
            id: 'play',
            title: 'Play with the agent',
            style: 'row',
            items: [
              { kind: 'mini-app', id: 'atlas' },
              { kind: 'mini-app', id: 'compass' },
              { kind: 'plugin', id: 'games@localix' },
            ],
          },
        ],
      },
    ])
    // A catalog the person added picks nothing for Discover.
    catalogs[0]!.builtIn = false
    expect(await provider.editorial!()).toEqual([])
  })

  test('an install shows its version, its switch, an offered update and its settings', async () => {
    const { catalog, offer, store, provider, enabled } = setup()
    offer('atlas')
    await store.install('atlas')
    await store.settled()
    catalog.apps[0]!.version = '1.1.0'
    await store.refresh()
    enabled.set('atlas', false)

    const [atlas] = (await provider.listings(actor)).listings
    expect(atlas!.installs).toEqual([
      { scope: 'user', version: '1.0.0', enabled: false, updateTo: '1.1.0' },
    ])
    expect(atlas!.job).toMatchObject({ action: 'update', phase: 'done' })
    expect(atlas!.configurable).toBeUndefined()
  })

  test('an install that declares settings is configurable; they come typed, secrets only as set', async () => {
    const { offer, store, provider, enabled, configs } = setup()
    offer('atlas')
    await store.install('atlas')
    await store.settled()
    enabled.set('atlas', true)
    configs.set('atlas', [
      {
        key: 'level',
        type: 'number',
        title: 'Level',
        description: 'How strong',
        required: false,
        secret: false,
        value: 3,
        isSet: true,
        min: 1,
        max: 9,
      },
      {
        key: 'token',
        type: 'string',
        description: '',
        required: true,
        secret: true,
        value: null,
        isSet: true,
      },
    ])
    const [atlas] = (await provider.listings(actor)).listings
    expect(atlas!.configurable).toBe(true)
    const config = await provider.config!('atlas', 'user', actor)
    expect(config).toMatchObject({
      scope: 'user',
      scopes: ['user'],
      values: { level: 3 },
      set: ['token'],
    })
    expect(config!.fields[0]).toMatchObject({ label: 'Level', type: 'number', min: 1, max: 9 })
    expect(await provider.config!('atlas', 'project', actor)).toBeNull()
    expect(await provider.config!('clock', 'user', actor)).toBeNull()
  })

  test('saving settings goes to the person’s mini app, in the way it keeps them', async () => {
    const { provider, calls } = setup()
    await provider.setConfig!('atlas', 'user', { level: 4, tags: ['a'] }, actor)
    expect(calls).toContain('config atlas {"level":4,"tags":"[\\"a\\"]"}')
    await expect(provider.setConfig!('atlas', 'project', {}, actor)).rejects.toThrow(
      'never for one project',
    )
  })

  test('its page: README, facts and what it adds', async () => {
    const { offer, provider } = setup()
    offer('atlas', {
      displayName: 'Atlas',
      license: 'MIT',
      author: 'Ada',
      homepage: 'https://example.test/atlas',
      surfaces: ['workbench'],
      commands: ['play'],
      readme: '# Atlas',
    })

    const detail = await provider.detail('atlas', actor)
    expect(detail.readme).toBe('# Atlas')
    expect(detail.media).toEqual([])
    expect(detail.facts).toEqual([
      { label: 'Version', value: '1.0.0' },
      { label: 'Size', value: expect.any(String) },
      { label: 'License', value: 'MIT' },
      { label: 'Author', value: 'Ada' },
      { label: 'Homepage', value: 'https://example.test/atlas' },
    ])
    expect(detail.components).toEqual([
      { kind: 'screen', name: 'Atlas', description: 'A screen of its own' },
      { kind: 'command', name: '/atlas:play' },
    ])
  })

  test('a plan says what runs; an unverified publisher needs a yes, given as consent', async () => {
    const { offer, store, provider } = setup({ verified: false })
    offer('radio', { displayName: 'Radio', surfaces: ['agent'] })

    const plan = await provider.plan('radio', 'user', actor)
    expect(plan.runs).toEqual([{ kind: 'backend', name: 'Radio' }])
    expect(plan.needsConsent).toBe(true)
    expect(plan.warnings).toEqual(['Someone is not a publisher Localix verifies'])

    await expect(provider.install('radio', 'user', { plan: false }, actor)).rejects.toMatchObject({
      code: 'mini_app_unverified',
    })
    await provider.install('radio', 'user', { plan: true }, actor)
    await store.settled()
    expect((await provider.listings(actor)).listings[0]!.installs).toHaveLength(1)
  })

  test('a mini app is installed for the person only, never for a project', async () => {
    const { offer, provider } = setup()
    offer('atlas')
    await expect(provider.plan('atlas', 'project', actor)).rejects.toMatchObject({
      code: 'mini_app_user_scope',
    })
    await expect(provider.install('atlas', 'project', { plan: true }, actor)).rejects.toMatchObject(
      { status: 400 },
    )
  })

  test('remove and the switch go to the person’s mini apps', async () => {
    const { provider, calls } = setup()
    await provider.remove('atlas', 'user', actor)
    await provider.setEnabled!('atlas', 'user', false, actor)
    expect(calls).toEqual(['remove atlas', 'enable atlas false'])
  })

  test('sources are the catalogs, labelled, with how many apps each offers', async () => {
    const { catalog, offer, provider, catalogs, calls } = setup()
    offer('atlas')
    catalogs.push({ url: ADA, builtIn: false })
    expect(await provider.sources()).toEqual([
      {
        kind: 'mini-app',
        id: catalog.url,
        label: 'Localix',
        url: catalog.url,
        builtIn: true,
        count: 1,
        trust: 'localix',
        defaultSource: true,
      },
      {
        kind: 'mini-app',
        id: ADA,
        label: 'ada.test',
        url: ADA,
        builtIn: false,
        count: 0,
        trust: 'community',
      },
    ])
    expect(await provider.previewSource!(ADA)).toEqual({
      kind: 'mini-app',
      id: ADA,
      label: 'ada.test',
      publishers: ['Ada'],
      count: 3,
      icons: [],
      verified: false,
      added: false,
    })
    await provider.addSource!(ADA)
    await provider.removeSource!(ADA)
    expect(calls).toEqual([`add ${ADA}`, `remove ${ADA}`])
  })

  test('a catalog that cannot be read is a source that says why, quietly', async () => {
    const store = createMiniAppStore({
      homeDir: join(root(), 'home'),
      sources: () => [{ kind: 'catalog', url: ADA, vouches: false }],
      fetchImpl: (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
      onInstalled: async () => {},
    })
    const calls: string[] = []
    const provider = createMiniAppStoreProvider({
      store: { ...store, refresh: async () => void calls.push('refresh') },
      catalogs: {
        list: async () => [{ url: ADA, builtIn: false }],
        add: async () => {},
        remove: async () => {},
        preview: async () => {
          throw new Error('unused')
        },
      },
      apps: {
        list: async () => ({ miniApps: [] }),
        setEnabled: async () => {},
        setConfig: async () => {},
        remove: async () => {},
      },
    })
    const [ada] = await provider.sources()
    expect(ada).toMatchObject({ id: ADA, count: 0 })
    expect(ada!.problem).toContain('404')
    await provider.refreshSource!(ADA)
    expect(calls).toEqual(['refresh'])
  })

  test('every move of an install is heard', async () => {
    const { offer, store, provider } = setup()
    offer('atlas')
    let heard = 0
    provider.subscribe(() => heard++)
    await provider.install('atlas', 'user', { plan: false }, actor)
    await store.settled()
    expect(heard).toBeGreaterThan(1)
  })

  test('a mini app the person made, which no catalog offers, is in the Store as installed', async () => {
    const { offer, provider, own } = setup()
    offer('atlas')
    own.push({
      name: 'bitcoin-price',
      displayName: 'Bitcoin Price',
      version: '0.1.0',
      description: 'Shows the Bitcoin price.',
      surfaces: ['agent', 'workbench'],
      commands: [],
      bundled: false,
      enabled: true,
      config: [],
    })
    const { listings } = await provider.listings(actor)
    const mine = listings.find((listing) => listing.ref.id === 'bitcoin-price')
    expect(mine).toMatchObject({
      displayName: 'Bitcoin Price',
      summary: 'Shows the Bitcoin price.',
      installs: [{ scope: 'user', version: '0.1.0', enabled: true }],
      source: { label: 'Made on this computer' },
      authored: 'user',
    })
    expect(listings.filter((listing) => listing.ref.id === 'atlas')).toHaveLength(1)
    const page = await provider.detail('bitcoin-price', actor)
    expect(page.components.map((component) => component.kind)).toEqual([
      'screen',
      'agent-tool',
      'backend',
    ])
    // Nothing to install: it is already here, and no catalog has it.
    await expect(provider.plan('bitcoin-price', 'user', actor)).rejects.toThrow()
  })
})
