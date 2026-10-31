import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { publicKeyOf } from '@localixai/mini-app-sdk/marketplace-signature'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  hostedMiniAppMarketplace,
  memoryTrust,
  type MarketplaceEntry,
} from '../../testing/mini-app-marketplace'
import type { MiniAppMarketplaceSource } from './marketplaces'
import { MINI_APPS_SUBDIR } from './paths'
import { createMiniAppStore } from './store'
import type { MiniAppConfigField } from './contracts'
import { createMiniAppStoreProvider } from './store-provider'

const root = tempDirPerTest('mini-app-store-provider-')
const actor = { userId: 'u1' }
const ADA = 'https://ada.test/mini-app-marketplace.json'
/** Installed apps their marketplace took back, by name, as the mini apps feature reads them. */
const revokedApps = new Map<string, string>()
afterEach(() => revokedApps.clear())

function setup(opts: { verified?: boolean; collections?: unknown; signed?: boolean } = {}) {
  const author = generateKeyPairSync('ed25519').privateKey
  const vouched = opts.verified !== false
  const marketplace = hostedMiniAppMarketplace([], {
    name: 'localix',
    owner: vouched ? 'Localix' : 'Ada',
    collections: opts.collections,
    ...(opts.signed ? { signWith: [author] } : {}),
  })
  /** Offer an app in the marketplace; what it says is read when the store next asks. */
  const offer = (name: string, extra: Partial<MarketplaceEntry> = {}) =>
    void marketplace.apps.push({ name, ...extra })
  const marketplaces: MiniAppMarketplaceSource[] = [
    {
      url: marketplace.url,
      name: 'localix',
      builtIn: vouched,
      vouches: vouched,
      id: 'localix-mini-apps',
      ...(opts.signed ? { pinned: [publicKeyOf(author)] } : {}),
    },
  ]
  /** The marketplace is one the person added: Localix vouches for none of it. */
  const addedByPerson = () => Object.assign(marketplaces[0]!, { builtIn: false, vouches: false })
  const store = createMiniAppStore({
    homeDir: join(root(), 'home'),
    sources: () => marketplaces.slice(0, 1),
    trust: memoryTrust(),
    onInstalled: async () => {},
    fetchImpl: marketplace.fetchImpl,
  })
  const calls: string[] = []
  const autoUpdateOff = new Set<string>()
  const enabled = new Map<string, boolean>()
  const configs = new Map<string, MiniAppConfigField[]>()
  const own: Record<string, unknown>[] = []
  const provider = createMiniAppStoreProvider({
    store,
    marketplaces: {
      list: async () => marketplaces,
      add: async (url) => void calls.push(`add ${url}`),
      remove: async (url) => void calls.push(`remove ${url}`),
      preview: async (url) => ({
        url,
        name: 'ada',
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
            ...(revokedApps.has(name) ? { revoked: revokedApps.get(name) } : {}),
          })),
          ...(own as never[]),
        ],
      }),
      setConfig: async (_userId, { name, values }) =>
        void calls.push(`config ${name} ${JSON.stringify(values)}`),
      setEnabled: async (_userId, { name, enabled: on }) => void calls.push(`enable ${name} ${on}`),
      remove: async (_userId, { name }) => void calls.push(`remove ${name}`),
    },
    autoUpdate: {
      off: async () => new Set(autoUpdateOff),
      set: async (name, on) => {
        calls.push(`auto-update ${name} ${on}`)
        if (on) autoUpdateOff.delete(name)
        else autoUpdateOff.add(name)
      },
    },
  })
  return {
    marketplace,
    offer,
    store,
    provider,
    calls,
    enabled,
    marketplaces,
    addedByPerson,
    configs,
    own,
  }
}

describe('the mini apps in the Store', () => {
  test('an offer is a listing: what it is, where it comes from and what is inside', async () => {
    const { marketplace, offer, provider } = setup()
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
      ref: { kind: 'mini-app', id: 'atlas@localix' },
      name: 'atlas',
      displayName: 'Atlas',
      summary: 'atlas app',
      category: 'games',
      tags: ['board-game'],
      publisher: { name: 'Localix', verified: true },
      source: { id: marketplace.url, label: 'Localix' },
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

  test('Localix’s own marketplace is trusted and editorial; one the person added is community', async () => {
    const { offer, provider, addedByPerson } = setup()
    offer('atlas', { featured: true })
    const [own] = (await provider.listings(actor)).listings
    expect(own!.source).toMatchObject({ trust: 'localix', weight: 1 })
    expect(own!.origin).toBe(
      'mini-app:marketplace.example.test/mini-apps/mini-app-marketplace.json#atlas',
    )
    expect(own!.featured).toBe(true)

    addedByPerson()
    await provider.refresh!()
    const [added] = (await provider.listings(actor)).listings
    expect(added!.source).toMatchObject({ trust: 'community', weight: 0.35 })
    // Its picks do not reach Discover: only an editorial source's do.
    expect(added!.featured).toBe(false)
  })

  // Localix Community comes with Localix, but Localix vouches for none of what it lists.
  test('Localix Community comes with Localix and is named, but is community, not editorial', async () => {
    const { offer, provider, marketplaces } = setup()
    offer('atlas', { featured: true })
    Object.assign(marketplaces[0]!, {
      builtIn: true,
      vouches: false,
      id: 'localix-community-mini-apps',
    })
    const [listed] = (await provider.listings(actor)).listings
    expect(listed!.source).toMatchObject({
      label: 'Localix Community',
      trust: 'community',
      weight: 0.35,
    })
    expect(listed!.featured).toBe(false)
    const [source] = await provider.sources!()
    expect(source).toMatchObject({
      label: 'Localix Community',
      trust: 'community',
      defaultSource: true,
    })
  })

  test('what Localix’s marketplace suggests an app for reaches recommendations; an added one says nothing', async () => {
    const { offer, provider, addedByPerson } = setup()
    offer('atlas', {
      suggestFor: { files: ['*.pgn', 42], dependencies: ['chess.js'] },
    })
    offer('clock', { suggestFor: { files: 'clock.txt' } })

    const [atlas, clock] = (await provider.listings(actor)).listings
    expect(atlas!.suggestFor).toEqual({ files: ['*.pgn'], dependencies: ['chess.js'] })
    expect(clock!.suggestFor).toBeUndefined()

    addedByPerson()
    await provider.refresh!()
    const [added] = (await provider.listings(actor)).listings
    expect(added!.suggestFor).toBeUndefined()
  })

  test('Localix’s picks for Discover: and collections', async () => {
    const { marketplace, offer, provider, addedByPerson } = setup({
      collections: [
        {
          id: 'play',
          title: 'Play with the agent',
          items: ['atlas', 'compass', 'plugin:games@localix'],
        },
      ],
    })
    offer('atlas')
    offer('compass')
    expect(await provider.editorial!()).toEqual([
      {
        source: marketplace.url,
        collections: [
          {
            id: 'play',
            title: 'Play with the agent',
            style: 'row',
            items: [
              { kind: 'mini-app', id: 'atlas@localix' },
              { kind: 'mini-app', id: 'compass@localix' },
              { kind: 'plugin', id: 'games@localix' },
            ],
          },
        ],
      },
    ])
    // A marketplace the person added picks nothing for Discover.
    addedByPerson()
    await provider.refresh!()
    expect(await provider.editorial!()).toEqual([])
  })

  test('an install shows its version, its switch, an offered update and its settings', async () => {
    const { marketplace, offer, store, provider, enabled } = setup()
    offer('atlas')
    await store.install('atlas')
    await store.settled()
    marketplace.app('atlas').version = '1.1.0'
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
    expect(plan.warnings).toEqual(['Ada is not a publisher Localix verifies'])

    await expect(provider.install('radio', 'user', { plan: false }, actor)).rejects.toMatchObject({
      code: 'mini_app_unverified',
    })
    await provider.install('radio', 'user', { plan: true }, actor)
    await store.settled()
    expect((await provider.listings(actor)).listings[0]!.installs).toHaveLength(1)
  })

  // A mini app built here and the one its author published by the same name: Get takes the
  // published one, in place of the copy the name held. Their data is kept by name, so it stays.
  test('Get on an app whose name a mini app of the person’s holds replaces that copy', async () => {
    const { offer, store, provider } = setup()
    offer('atlas')
    const dir = join(root(), 'home', MINI_APPS_SUBDIR, 'atlas')
    writeTree(dir, {
      [MINI_APP_MANIFEST_FILE]: JSON.stringify({ name: 'atlas', version: '0.2.0' }),
      '.localix-install.json': JSON.stringify({
        kind: 'localix-local-install',
        source: '/src/atlas',
      }),
    })

    // What the person is asked to confirm, here or in the agent's card, says what gives way.
    expect((await provider.plan('atlas@localix', 'user', actor)).warnings).toContain(
      'Replaces your "atlas", built on this computer; its data stays',
    )
    await provider.install('atlas@localix', 'user', { plan: true }, actor)
    await store.settled()

    const atlas = (await provider.listings(actor)).listings.find(
      (listing) => listing.ref.id === 'atlas@localix',
    )
    expect(atlas?.installs).toMatchObject([{ scope: 'user', version: '1.0.0' }])
    expect(JSON.parse(readFileSync(join(dir, '.localix-install.json'), 'utf8'))).toMatchObject({
      kind: 'localix-marketplace-install',
      marketplace: 'localix',
    })
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

  test('sources are the marketplaces, by name, with how many apps each offers', async () => {
    const { marketplace, offer, provider, marketplaces, calls } = setup()
    offer('atlas')
    marketplaces.push({ url: ADA, name: 'ada', builtIn: false, vouches: false })
    expect(await provider.sources()).toEqual([
      {
        kind: 'mini-app',
        id: marketplace.url,
        label: 'Localix',
        url: marketplace.url,
        builtIn: true,
        count: 1,
        trust: 'localix',
        defaultSource: true,
      },
      {
        kind: 'mini-app',
        id: ADA,
        label: 'ada',
        url: ADA,
        builtIn: false,
        count: 0,
        trust: 'community',
      },
    ])
    expect(await provider.previewSource!(ADA)).toEqual({
      kind: 'mini-app',
      id: ADA,
      label: 'ada',
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

  test('a marketplace that cannot be read is a source that says why, quietly', async () => {
    const added = { url: ADA, name: 'ada', builtIn: false, vouches: false }
    const store = createMiniAppStore({
      homeDir: join(root(), 'home'),
      sources: () => [added],
      trust: memoryTrust(),
      fetchImpl: (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch,
      onInstalled: async () => {},
    })
    const calls: string[] = []
    const provider = createMiniAppStoreProvider({
      store: { ...store, refresh: async () => void calls.push('refresh') },
      marketplaces: {
        list: async () => [added],
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
      autoUpdate: { off: async () => new Set(), set: async () => {} },
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

  test('an install from a signed marketplace says so and updates on its own until switched off', async () => {
    const { offer, store, provider, calls } = setup({ signed: true })
    offer('atlas')
    offer('notes')
    await store.install('atlas')
    await store.settled()

    const listed = async () => (await provider.listings(actor)).listings
    const [atlas, notes] = await listed()
    expect(atlas).toMatchObject({ signature: 'signed', autoUpdate: true })
    // Not installed: nothing to update yet.
    expect(notes!.signature).toBe('signed')
    expect(notes!.autoUpdate).toBeUndefined()

    await provider.setAutoUpdate!('atlas', false, actor)
    expect(calls).toEqual(['auto-update atlas false'])
    expect((await listed())[0]!.autoUpdate).toBe(false)
  })

  test('an install from an unsigned marketplace says so, and has no switch: it updates when asked', async () => {
    const { offer, store, provider } = setup()
    offer('atlas')
    await store.install('atlas')
    await store.settled()

    const [atlas] = (await provider.listings(actor)).listings
    expect(atlas!.signature).toBe('unsigned')
    expect(atlas!.autoUpdate).toBeUndefined()
  })

  test('a mini app the person made, which no marketplace offers, is in the Store as installed', async () => {
    const { offer, provider, own } = setup()
    offer('atlas')
    own.push({
      name: 'bitcoin-price',
      displayName: 'Bitcoin Price',
      version: '0.1.0',
      description: 'Shows the Bitcoin price.',
      surfaces: ['agent', 'workbench'],
      commands: [],
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
    // No marketplace: nothing to sign, nothing updates it but the person.
    expect(mine!.signature).toBeUndefined()
    expect(mine!.autoUpdate).toBeUndefined()
    expect(listings.filter((listing) => listing.name === 'atlas')).toHaveLength(1)
    const page = await provider.detail('bitcoin-price', actor)
    expect(page.components.map((component) => component.kind)).toEqual([
      'screen',
      'agent-tool',
      'backend',
    ])
    // Nothing to install: it is already here, and no marketplace has it.
    await expect(provider.plan('bitcoin-price', 'user', actor)).rejects.toThrow()
  })

  // Its marketplace took it back: it is no longer offered, but it is still here, and it is still
  // that marketplace's app, not one the person made.
  test('an installed app its marketplace no longer offers is its marketplace’s, and says why it stopped', async () => {
    const { provider, own } = setup()
    own.push({
      name: 'radio',
      version: '1.0.0',
      description: 'Plays the radio.',
      installedFrom: { marketplace: 'ada', publisher: { name: 'Ada', verified: false } },
      revoked: 'It sends what you play to a server.',
      enabled: true,
      config: [],
    })
    const [radio] = (await provider.listings(actor)).listings
    expect(radio).toMatchObject({
      ref: { kind: 'mini-app', id: 'radio' },
      publisher: { name: 'Ada', verified: false },
      source: { label: 'ada' },
      revoked: 'It sends what you play to a server.',
      installs: [{ scope: 'user', version: '1.0.0' }],
    })
    expect(radio!.authored).toBeUndefined()
  })

  // Taken back by a marketplace built into Localix: it reads as that marketplace does elsewhere.
  test('an app a built-in marketplace no longer offers is labelled as that marketplace', async () => {
    const { provider, own } = setup()
    own.push({
      name: 'radio',
      version: '1.0.0',
      description: 'Plays the radio.',
      installedFrom: { marketplace: 'localix', publisher: { name: 'Localix', verified: true } },
      revoked: 'It sends what you play to a server.',
      enabled: true,
      config: [],
    })
    const [radio] = (await provider.listings(actor)).listings
    expect(radio!.source.label).toBe('Localix')
  })

  test('an installed app taken back at its version says so beside the version that fixes it', async () => {
    const { offer, store, provider, enabled } = setup()
    offer('atlas')
    await store.install('atlas')
    await store.settled()
    enabled.set('atlas', true)
    const listed = async () => (await provider.listings(actor)).listings[0]!
    expect((await listed()).revoked).toBeUndefined()
    revokedApps.set('atlas', 'Version 1.0.0 deletes your notes.')
    expect((await listed()).revoked).toBe('Version 1.0.0 deletes your notes.')
  })

  test('a mini app the person published links its page to where it lives', async () => {
    const { provider, own } = setup()
    own.push({
      name: 'bitcoin-price',
      version: '0.2.0',
      description: 'Shows the Bitcoin price.',
      homepage: 'https://github.com/you/bitcoin-price',
      enabled: true,
      config: [],
    })
    const page = await provider.detail('bitcoin-price', actor)
    expect(page.facts).toContainEqual({
      label: 'Homepage',
      value: 'https://github.com/you/bitcoin-price',
    })
  })

  test('a file finds the mini apps that open it, from what each marketplace entry declares', async () => {
    const { offer, provider } = setup()
    offer('documents', {
      fileAssociations: [{ ext: ['docx', 'pdf'], name: 'Word Document', role: 'Viewer' }],
    })
    offer('reader', {
      fileAssociations: [
        { ext: ['epub'], name: 'EPUB Book' },
        // It reads Markdown too, but asks not to be offered for it: the editor opens Markdown.
        { ext: ['md'], name: 'Markdown', rank: 'None' },
        'not one',
        { ext: [], name: 'X' },
      ],
    })
    offer('clock')
    const { listings } = await provider.listings(actor)
    expect(Object.fromEntries(listings.map((l) => [l.ref.id, l.opens]))).toEqual({
      'documents@localix': ['docx', 'pdf'],
      'reader@localix': ['epub'],
      'clock@localix': undefined,
    })
    const ids = async (path: string) =>
      (await provider.openers!(path, actor)).map((listing) => listing.ref.id)
    expect(await ids('/work/Report.DOCX')).toEqual(['documents@localix'])
    expect(await ids('/work/scan.pdf')).toEqual(['documents@localix'])
    expect(await ids('/work/notes.txt')).toEqual([])
    expect(await ids('/work/README.md')).toEqual([])
  })
})
