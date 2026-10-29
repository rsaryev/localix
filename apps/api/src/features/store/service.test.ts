import { afterEach, describe, expect, test } from 'bun:test'
import type { StoreProvider } from '@localixai/store'

import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'

const actor = { userId: 'u1' }
const atlas = makeListing({ id: 'atlas', featured: true })
const tasks = makeListing({
  id: 'tasks',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})
const review = makeListing({ id: 'review', kind: 'plugin', contents: { skill: 2 } })

let opened: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})
const storeOf = (providers: StoreProvider[], opts?: Parameters<typeof makeStore>[1]) =>
  (opened = makeStore(providers, opts))

function setup() {
  const apps = fakeProvider('mini-app', [atlas, tasks], {
    sources: [
      {
        kind: 'mini-app',
        id: 'https://hosted.test/c.json',
        label: 'Localix',
        url: 'https://hosted.test/c.json',
        builtIn: true,
        count: 2,
      },
    ],
  })
  const plugins = fakeProvider('plugin', [review], { withoutOptional: true })
  const { store } = storeOf([apps.provider, plugins.provider])
  let pokes = 0
  store.subscribe(() => pokes++)
  return { apps, plugins, store, pokes: () => pokes }
}

const ids = (page: { listings: { ref: { id: string } }[] }) => page.listings.map((l) => l.ref.id)

describe('the Store', () => {
  test('lists every provider’s packages, and reads a provider again only once it changed', async () => {
    const { apps, store, pokes } = setup()
    // The plugin's summary places it in Development, so it ranks above the uncategorized app.
    expect(ids(await store.listings(actor, {}))).toEqual(['atlas', 'review', 'tasks'])
    expect(ids(await store.listings(actor, { shelf: 'package:plugin' }))).toEqual(['review'])
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(1)

    apps.change([atlas])
    await store.settled()
    expect(pokes()).toBe(2)
    expect(ids(await store.listings(actor, {}))).toEqual(['atlas', 'review'])
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(2)
  })

  test('a change announced elsewhere is read again once the Store is told', async () => {
    const { apps, store } = setup()
    await store.listings(actor, {})
    store.invalidate()
    await store.settled()
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(2)
  })

  test('the sources are fetched again on the Store’s schedule, and what moved is indexed', async () => {
    const { apps, plugins, store } = setup()
    await store.listings(actor, {})
    await store.refreshSources()
    await store.settled()
    expect(apps.calls).toEqual(['listings', 'refresh', 'listings'])
    expect(plugins.calls).toEqual(['listings', 'refresh', 'listings'])
  })

  test('a re-read that changes nothing writes nothing and pokes no one', async () => {
    const { store, pokes } = setup()
    await store.listings(actor, {})
    const before = pokes()
    store.invalidate()
    await store.settled()
    expect(pokes()).toBe(before)
  })

  test('a provider that cannot list is a problem of its kind; the others still answer', async () => {
    const broken = fakeProvider('plugin', [], { fails: 'marketplace unreachable' })
    const apps = fakeProvider('mini-app', [atlas])
    const { store } = storeOf([apps.provider, broken.provider])
    expect(ids(await store.listings(actor, {}))).toEqual(['atlas'])
    expect((await store.listings(actor, { shelf: 'package:plugin' })).problems).toEqual([
      { kind: 'plugin', message: 'marketplace unreachable' },
    ])
  })

  // A plugin marketplace that could not be read was once said above the mini apps too.
  test('a source that could not be read is said only on the shelves that list its kind', async () => {
    const plugins = fakeProvider('plugin', [review], {
      problems: ['The plugin marketplace "llx" could not be read'],
    })
    const apps = fakeProvider('mini-app', [atlas])
    const { store } = storeOf([apps.provider, plugins.provider])
    const problems = async (query: Parameters<typeof store.listings>[1]) =>
      (await store.listings(actor, query)).problems.map((problem) => problem.kind)
    expect(await problems({ shelf: 'package:plugin' })).toEqual(['plugin'])
    // A plugin gives skills, agents and MCP servers: their shelves miss what it would have given.
    expect(await problems({ shelf: 'capability:skill' })).toEqual(['plugin'])
    expect(await problems({ shelf: 'package:mini-app' })).toEqual([])
    expect(await problems({ shelf: 'installed' })).toEqual([])
    expect(await problems({})).toEqual([])
    expect(await problems({ q: 'review' })).toEqual([])
  })

  test('a source removed once it could not be read leaves the lists: they hear it and say nothing', async () => {
    const plugins = fakeProvider('plugin', [review], {
      problems: ['The plugin marketplace "llx" could not be read'],
    })
    const { store } = storeOf([plugins.provider])
    let pokes = 0
    store.subscribe(() => pokes++)
    expect((await store.listings(actor, { shelf: 'package:plugin' })).problems).toHaveLength(1)
    await store.settled()
    const before = pokes
    // Its listings are the same — an unread source had none — only what could not be read moved.
    plugins.change([review], [])
    await store.settled()
    expect(pokes).toBeGreaterThan(before)
    expect((await store.listings(actor, { shelf: 'package:plugin' })).problems).toEqual([])
  })

  test('a mini app source that could not be read is said where mini apps give something', async () => {
    const apps = fakeProvider('mini-app', [atlas], { problems: ['The catalog answered 503'] })
    const { store } = storeOf([apps.provider])
    const problems = async (shelf: string) =>
      (await store.listings(actor, { shelf } as never)).problems.map((problem) => problem.kind)
    expect(await problems('package:mini-app')).toEqual(['mini-app'])
    expect(await problems('capability:command')).toEqual(['mini-app'])
    expect(await problems('capability:skill')).toEqual([])
    expect(await problems('package:plugin')).toEqual([])
  })

  test('a page comes with facets over every listing', async () => {
    const { store } = setup()
    const page = await store.listings(actor, { shelf: 'updates' })
    expect(ids(page)).toEqual(['tasks'])
    expect(page.facets.kind).toEqual({ 'mini-app': 2, plugin: 1 })
    expect(page.facets.updates).toBe(1)
    expect(page.facets.shelves['capability:skill']).toBe(2)
  })

  test('a long shelf comes a page at a time', async () => {
    const many = Array.from({ length: 45 }, (_, n) =>
      makeListing({ id: `app-${String(n).padStart(2, '0')}` }),
    )
    const { store } = storeOf([fakeProvider('mini-app', many).provider])
    const first = await store.listings(actor, {})
    expect(first.listings).toHaveLength(40)
    const second = await store.listings(actor, { cursor: first.nextCursor! })
    expect(ids(second)).toEqual(['app-40', 'app-41', 'app-42', 'app-43', 'app-44'])
    expect(second.nextCursor).toBeUndefined()
  })

  test('each action reaches the provider of the listing’s kind', async () => {
    const { apps, plugins, store } = setup()
    await store.install({ kind: 'mini-app', id: 'atlas' }, 'user', { plan: true }, actor)
    await store.update({ kind: 'mini-app', id: 'tasks' }, 'user', actor)
    await store.remove({ kind: 'plugin', id: 'review' }, 'project', actor)
    await store.setEnabled({ kind: 'mini-app', id: 'tasks' }, 'user', false, actor)
    expect(apps.calls).toEqual([
      'install atlas user true',
      'update tasks user',
      'enable tasks user false',
    ])
    expect(plugins.calls).toEqual(['remove review project'])
    expect((await store.plan({ kind: 'plugin', id: 'review' }, 'user', actor)).warnings).toEqual([
      'plan for review',
    ])
    expect((await store.detail({ kind: 'mini-app', id: 'atlas' }, actor)).readme).toContain('atlas')
  })

  test('what a detail page learned a package contains shows on its card and shelves', async () => {
    const remote = makeListing({ id: 'remote', kind: 'plugin', contents: 'unknown' })
    const plugins = fakeProvider('plugin', [remote])
    plugins.provider.detail = async () => ({
      ...remote,
      readme: null,
      media: [],
      facts: [],
      components: [
        { kind: 'skill', name: 'review' },
        { kind: 'command', name: '/review' },
      ],
    })
    const { store } = storeOf([plugins.provider])
    expect((await store.listings(actor, {})).facets.shelves['capability:skill']).toBeUndefined()
    await store.detail(remote.ref, actor)
    const page = await store.listings(actor, { shelf: 'capability:skill' })
    expect(ids(page)).toEqual(['remote'])
    expect(page.listings[0]!.contents).toEqual({ skill: 1, command: 1 })
  })

  // Hovering cards while scrolling opens their pages: each learned package re-embeds its own
  // card, never the whole collection again (the status bar showed a full rescan per card).
  test('a page that learned what a package contains re-embeds that listing alone', async () => {
    const remote = makeListing({ id: 'remote', kind: 'plugin', contents: 'unknown' })
    const plugins = fakeProvider('plugin', [remote])
    plugins.provider.detail = async () => ({
      ...remote,
      readme: null,
      media: [],
      facts: [],
      components: [{ kind: 'skill', name: 'review' }],
    })
    const resyncs: string[] = []
    const changed: string[][] = []
    const { store } = storeOf([plugins.provider], {
      resyncMeaning: () => resyncs.push('all'),
      meaningChanged: (keys) => changed.push(keys),
    })
    await store.listings(actor, {})
    resyncs.length = 0
    await store.detail(remote.ref, actor)
    await store.detail(remote.ref, actor)
    expect({ resyncs, changed }).toEqual({ resyncs: [], changed: [['plugin:remote']] })
  })

  test('a kind no provider serves, or a capability its provider lacks, is refused', async () => {
    const { store } = setup()
    await expect(store.detail({ kind: 'skill', id: 'x' }, actor)).rejects.toMatchObject({
      status: 404,
      code: 'store_kind_unknown',
    })
    await expect(
      store.setEnabled({ kind: 'plugin', id: 'review' }, 'user', true, actor),
    ).rejects.toMatchObject({ status: 409, code: 'store_unsupported' })
    await expect(store.addSource('plugin', 'https://x.test')).rejects.toMatchObject({
      code: 'store_unsupported',
    })
  })

  test('sources are listed by provider and added, previewed and removed through it', async () => {
    const { apps, store } = setup()
    expect((await store.sources()).sources.map((source) => source.label)).toEqual(['Localix'])
    expect((await store.previewSource('mini-app', 'https://ada.test/c.json')).publishers).toEqual([
      'Ada',
    ])
    await store.addSource('mini-app', 'https://ada.test/c.json')
    await store.removeSource('mini-app', 'https://ada.test/c.json')
    expect(apps.calls).toContain('add source https://ada.test/c.json')
    expect(apps.calls).toContain('remove source https://ada.test/c.json')
  })

  test('a source write is announced at once to those who read the sources, though no listing moved', async () => {
    const { store, apps, pokes } = setup()
    await store.listings(actor, {})
    await store.settled()
    const heard: string[] = []
    store.subscribeSources(() => heard.push('sources'))
    const before = pokes()
    await store.setSourceAutoUpdate('mini-app', 'https://hosted.test/c.json', true)
    expect(heard).toEqual(['sources'])
    await store.refreshSource('mini-app', 'https://hosted.test/c.json')
    await store.addSource('mini-app', 'https://ada.test/c.json')
    await store.removeSource('mini-app', 'https://ada.test/c.json')
    expect(heard).toHaveLength(4)
    await store.settled()
    expect(pokes()).toBe(before)
    expect(apps.calls).toContain('auto-update https://hosted.test/c.json true')
  })

  test('a source that changed on its own is announced once the Store has read again', async () => {
    const sources = [
      {
        kind: 'mini-app' as const,
        id: 'https://hosted.test/c.json',
        label: 'Localix',
        url: 'https://hosted.test/c.json',
        builtIn: true,
        count: 2,
        autoUpdate: false,
      },
    ]
    const apps = fakeProvider('mini-app', [atlas], { sources })
    const { store } = storeOf([apps.provider])
    await store.listings(actor, {})
    await store.settled()
    const heard: string[] = []
    store.subscribeSources(() => heard.push('sources'))
    await store.settled()
    expect(heard).toEqual([])
    sources[0]!.autoUpdate = true
    apps.change([atlas])
    await store.settled()
    expect(heard).toEqual(['sources'])
    apps.change([atlas])
    await store.settled()
    expect(heard).toEqual(['sources'])
  })

  test('activity: the jobs in flight and the updates offered, across kinds', async () => {
    const { apps, plugins, store } = setup()
    await store.listings(actor, {})
    apps.change([
      { ...atlas, job: { action: 'install', phase: 'downloading', received: 1, total: 4 } },
      tasks,
    ])
    plugins.change([
      { ...review, installs: [{ scope: 'user', version: '1', enabled: true }] },
      makeListing({
        id: 'lint',
        kind: 'plugin',
        installs: [{ scope: 'user', version: '2', enabled: true, updateTo: '3' }],
        job: { action: 'update', phase: 'installing' },
      }),
    ])
    await store.settled()
    expect(await store.activity(actor)).toEqual({
      jobs: [
        {
          ref: { kind: 'mini-app', id: 'atlas' },
          displayName: 'atlas',
          action: 'install',
          phase: 'downloading',
          received: 1,
          total: 4,
        },
        {
          ref: { kind: 'plugin', id: 'lint' },
          displayName: 'lint',
          action: 'update',
          phase: 'installing',
        },
      ],
      updates: [
        {
          ref: { kind: 'mini-app', id: 'tasks' },
          displayName: 'tasks',
          from: '1.0.0',
          to: '1.1.0',
        },
      ],
    })
  })

  test('Update all re-reads every source, then updates each install a newer version is offered for', async () => {
    const { apps, plugins, store } = setup()
    const queued = await store.applyUpdates(actor)
    expect(queued).toEqual([{ kind: 'mini-app', id: 'tasks' }])
    expect(apps.calls).toEqual(['refresh', 'listings', 'update tasks user'])
    expect(plugins.calls).toEqual(['refresh', 'listings'])
  })

  test('Update all passes over an install its provider refuses to update, and queues the rest', async () => {
    const { apps, store } = setup()
    const radio = makeListing({
      id: 'radio',
      installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '2.0.0' }],
    })
    apps.change([radio, tasks])
    apps.provider.update = async (id) => {
      if (id === 'radio') throw new Error('A mini app of yours is already called "radio"')
      apps.calls.push(`update ${id}`)
    }
    expect(await store.applyUpdates(actor)).toEqual([{ kind: 'mini-app', id: 'tasks' }])
  })

  test('a kind made here rather than installed is refused by the Store, and still syncs', async () => {
    const skill = makeListing({ id: 'review', kind: 'skill' })
    const { store } = storeOf([fakeProvider('skill', [skill], { madeHere: true }).provider])
    const ref = { kind: 'skill', id: 'review' } as const
    const refused = { code: 'store_unsupported' }
    await expect(store.plan(ref, 'user', actor)).rejects.toMatchObject(refused)
    await expect(store.install(ref, 'user', { plan: true }, actor)).rejects.toMatchObject(refused)
    await expect(store.update(ref, 'user', actor)).rejects.toMatchObject(refused)
    await store.refreshSources()
    expect(await store.applyUpdates(actor)).toEqual([])
    expect((await store.sources()).sources).toEqual([])
  })

  test('Update all still updates the other kinds when one source cannot be read', async () => {
    const { plugins, store } = setup()
    plugins.provider.refresh = () => Promise.reject(new Error('marketplace offline'))
    expect(await store.applyUpdates(actor)).toEqual([{ kind: 'mini-app', id: 'tasks' }])
  })

  test('a page opened before its package is fetched leaves what it contains unknown', async () => {
    const remote = makeListing({ id: 'pg', kind: 'plugin', contents: 'unknown' })
    const plugins = fakeProvider('plugin', [remote])
    const { store } = storeOf([plugins.provider])
    await store.detail({ kind: 'plugin', id: 'pg' }, actor)
    const page = await store.listings(actor, { shelf: 'package:plugin' })
    expect(page.listings[0]!.contents).toBe('unknown')
  })
})
