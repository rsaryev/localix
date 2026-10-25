import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tempDirPerTest } from '@localixai/testing'

import { __resetBundledSyncCache } from './bundled-install'
import { createMiniAppStore, type MiniAppStoreSource } from './store'
import type { MiniAppConfigField } from './contracts'
import { createMiniAppStoreProvider } from './store-provider'

const root = tempDirPerTest('mini-app-store-provider-')
const actor = { userId: 'u1' }
const ADA = 'https://ada.test/mini-app-catalog.json'

async function offer(source: string, name: string, extra: Record<string, unknown> = {}) {
  await fs.mkdir(join(source, name), { recursive: true })
  await fs.writeFile(
    join(source, name, 'mini-app.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} app`, ...extra }),
  )
}

function setup(publisher = { name: 'Localix', verified: true }) {
  const source = join(root(), 'staged')
  const local: MiniAppStoreSource = { kind: 'local', root: source, publisher, vouches: true }
  const store = createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => [local],
    onInstalled: async () => {},
  })
  const calls: string[] = []
  const enabled = new Map<string, boolean>()
  const configs = new Map<string, MiniAppConfigField[]>()
  const catalogs = [{ url: pathToFileURL(source).href, builtIn: true }]
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
        miniApps: [...enabled].map(([name, on]) => ({
          name,
          enabled: on,
          config: configs.get(name) ?? [],
        })),
      }),
      setConfig: async (_userId, { name, values }) =>
        void calls.push(`config ${name} ${JSON.stringify(values)}`),
      setEnabled: async (_userId, { name, enabled: on }) => void calls.push(`enable ${name} ${on}`),
      remove: async (_userId, { name }) => void calls.push(`remove ${name}`),
    },
  })
  return { source, store, provider, calls, enabled, catalogs, configs }
}

afterEach(() => __resetBundledSyncCache())

describe('the mini apps in the Store', () => {
  test('an offer is a listing: what it is, where it comes from and what is inside', async () => {
    const { source, provider } = setup()
    await offer(source, 'chess', {
      displayName: 'Chess',
      category: 'games',
      tags: ['board-game'],
      surfaces: ['agent', 'workbench'],
      commands: { play: { prompt: 'Play', description: 'Play' }, hint: { prompt: 'Hint' } },
    })
    await offer(source, 'clock', { surfaces: ['workbench'] })
    await fs.writeFile(join(source, 'catalog-picks.json'), JSON.stringify({ featured: ['chess'] }))

    const { listings, problems } = await provider.listings(actor)
    expect(problems).toEqual([])
    const [chess, clock] = listings
    expect(chess).toMatchObject({
      ref: { kind: 'mini-app', id: 'chess' },
      name: 'chess',
      displayName: 'Chess',
      summary: 'chess app',
      category: 'games',
      tags: ['board-game'],
      publisher: { name: 'Localix', verified: true },
      source: { id: pathToFileURL(source).href, label: 'Localix' },
      version: '1.0.0',
      contents: { screen: 1, 'agent-tool': 1, backend: 1, command: 2 },
      runsCode: true,
      featured: true,
      recommended: false,
      installs: [],
    })
    expect(chess!.components).toEqual([
      { kind: 'screen', name: 'Chess', description: 'A screen of its own' },
      { kind: 'agent-tool', name: 'Agent tools', description: 'Tools for the agent' },
      { kind: 'backend', name: 'Chess', description: 'Runs on this computer' },
      { kind: 'command', name: '/chess:play' },
      { kind: 'command', name: '/chess:hint' },
    ])
    expect(clock).toMatchObject({ displayName: 'clock', contents: { screen: 1 }, runsCode: false })
  })

  test('Localix’s own catalog is trusted and editorial; one the person added is community', async () => {
    const { source, provider, catalogs } = setup()
    await offer(source, 'chess')
    await fs.writeFile(join(source, 'catalog-picks.json'), JSON.stringify({ featured: ['chess'] }))
    const [own] = (await provider.listings(actor)).listings
    expect(own!.source).toMatchObject({ trust: 'localix', weight: 1 })
    expect(own!.origin).toBe('catalog:chess')
    expect(own!.featured).toBe(true)

    catalogs[0]!.builtIn = false
    const [added] = (await provider.listings(actor)).listings
    expect(added!.source).toMatchObject({ trust: 'community', weight: 0.35 })
    // Its picks do not reach Discover: only an editorial source's do.
    expect(added!.featured).toBe(false)
  })

  test('Localix’s picks for Discover: and collections', async () => {
    const { source, provider, catalogs } = setup()
    await offer(source, 'chess')
    await offer(source, 'checkers')
    await fs.writeFile(
      join(source, 'catalog-picks.json'),
      JSON.stringify({
        collections: [
          {
            id: 'play',
            title: 'Play with the agent',
            items: ['chess', 'checkers', 'plugin:games@localix'],
          },
        ],
      }),
    )
    expect(await provider.editorial!()).toEqual([
      {
        source: pathToFileURL(source).href,
        collections: [
          {
            id: 'play',
            title: 'Play with the agent',
            style: 'row',
            items: [
              { kind: 'mini-app', id: 'chess' },
              { kind: 'mini-app', id: 'checkers' },
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
    const { source, store, provider, enabled } = setup()
    await offer(source, 'chess')
    await store.install('chess')
    await store.settled()
    await offer(source, 'chess', { version: '1.1.0' })
    enabled.set('chess', false)

    const [chess] = (await provider.listings(actor)).listings
    expect(chess!.installs).toEqual([
      { scope: 'user', version: '1.0.0', enabled: false, updateTo: '1.1.0' },
    ])
    expect(chess!.job).toMatchObject({ action: 'update', phase: 'done' })
    expect(chess!.configurable).toBeUndefined()
  })

  test('an install that declares settings is configurable; they come typed, secrets only as set', async () => {
    const { source, store, provider, enabled, configs } = setup()
    await offer(source, 'chess')
    await store.install('chess')
    await store.settled()
    enabled.set('chess', true)
    configs.set('chess', [
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
    const [chess] = (await provider.listings(actor)).listings
    expect(chess!.configurable).toBe(true)
    const config = await provider.config!('chess', 'user', actor)
    expect(config).toMatchObject({
      scope: 'user',
      scopes: ['user'],
      values: { level: 3 },
      set: ['token'],
    })
    expect(config!.fields[0]).toMatchObject({ label: 'Level', type: 'number', min: 1, max: 9 })
    expect(await provider.config!('chess', 'project', actor)).toBeNull()
    expect(await provider.config!('clock', 'user', actor)).toBeNull()
  })

  test('saving settings goes to the person’s mini app, in the way it keeps them', async () => {
    const { provider, calls } = setup()
    await provider.setConfig!('chess', 'user', { level: 4, tags: ['a'] }, actor)
    expect(calls).toContain('config chess {"level":4,"tags":"[\\"a\\"]"}')
    await expect(provider.setConfig!('chess', 'project', {}, actor)).rejects.toThrow(
      'never for one project',
    )
  })

  test('its page: README, pictures, facts and what it adds', async () => {
    const { source, provider } = setup()
    await offer(source, 'chess', {
      displayName: 'Chess',
      license: 'MIT',
      author: 'Ada',
      homepage: 'https://example.test/chess',
      icon: 'icon.svg',
      screenshots: [{ path: 'shots/board.png', caption: 'The board' }],
      surfaces: ['workbench'],
      commands: { play: { prompt: 'Play' } },
    })
    await fs.writeFile(join(source, 'chess', 'README.md'), '# Chess')

    const detail = await provider.detail('chess', actor)
    expect(detail.readme).toBe('# Chess')
    expect(detail.media).toEqual([
      {
        url: expect.stringContaining('/rpc/mini-apps/store/media/chess/screenshot/0'),
        caption: 'The board',
      },
    ])
    expect(detail.facts).toEqual([
      { label: 'Version', value: '1.0.0' },
      { label: 'License', value: 'MIT' },
      { label: 'Author', value: 'Ada' },
      { label: 'Homepage', value: 'https://example.test/chess' },
    ])
    expect(detail.components).toEqual([
      { kind: 'screen', name: 'Chess', description: 'A screen of its own' },
      { kind: 'command', name: '/chess:play' },
    ])
  })

  test('a plan says what runs; an unverified publisher needs a yes, given as consent', async () => {
    const { source, store, provider } = setup({ name: 'Someone', verified: false })
    await offer(source, 'radio', { displayName: 'Radio', surfaces: ['agent'] })

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
    const { source, provider } = setup()
    await offer(source, 'chess')
    await expect(provider.plan('chess', 'project', actor)).rejects.toMatchObject({
      code: 'mini_app_user_scope',
    })
    await expect(provider.install('chess', 'project', { plan: true }, actor)).rejects.toMatchObject(
      { status: 400 },
    )
  })

  test('remove and the switch go to the person’s mini apps', async () => {
    const { provider, calls } = setup()
    await provider.remove('chess', 'user', actor)
    await provider.setEnabled!('chess', 'user', false, actor)
    expect(calls).toEqual(['remove chess', 'enable chess false'])
  })

  test('sources are the catalogs, labelled, with how many apps each offers', async () => {
    const { source, provider, catalogs, calls } = setup()
    await offer(source, 'chess')
    catalogs.push({ url: ADA, builtIn: false })
    expect(await provider.sources()).toEqual([
      {
        kind: 'mini-app',
        id: pathToFileURL(source).href,
        label: 'Localix',
        url: pathToFileURL(source).href,
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
    const local: MiniAppStoreSource = {
      kind: 'local',
      root: join(root(), 'staged'),
      publisher: { name: 'Localix', verified: true },
    }
    const store = createMiniAppStore({
      homeDir: join(root(), 'home'),
      sources: () => [local, { kind: 'catalog', url: ADA, vouches: false }],
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
    const { source, store, provider } = setup()
    await offer(source, 'chess')
    let heard = 0
    provider.subscribe(() => heard++)
    await provider.install('chess', 'user', { plan: false }, actor)
    await store.settled()
    expect(heard).toBeGreaterThan(1)
  })
})
