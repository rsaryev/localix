import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { Listing } from '@localixai/store'

import type { AppContext } from '../../app'
import { createStoreRoutes } from './routes'
import { fakeProvider, makeListing } from './testing/fake-provider'
import { TEST_NOW } from './testing'
import { makeStore } from './testing/store'

const actor = { userId: 'u1' }
let opened: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})
const DAY = 24 * 60 * 60 * 1000
const ids = (listings: readonly Listing[]) => listings.map((listing) => listing.ref.id)

const docker = Array.from({ length: 12 }, (_, at) =>
  makeListing({ id: `docker-${at + 1}`, kind: 'plugin', summary: 'Containers', tags: [] }),
)
const installed = makeListing({
  id: 'docker-installed',
  kind: 'plugin',
  displayName: 'Box',
  summary: 'Containers',
  tags: [],
  installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
})
const fonts = makeListing({ id: 'fonts', kind: 'plugin', summary: 'Typography', tags: [] })

/**
 * The semantic index, standing in: a docker listing is near any text about containers, ranked by
 * its number, and the fonts listing near any text about typography.
 */
function meaning(asked: string[] = []) {
  return (text: string) => {
    asked.push(text)
    return [
      ...(text.includes('docker')
        ? [...docker, installed].map((listing, at) => ({
            key: `plugin:${listing.ref.id}`,
            z: 4 - at / 10,
          }))
        : []),
      ...(text.includes('font') ? [{ key: 'plugin:fonts', z: 3 }] : []),
    ]
  }
}

const storeOf = (opts: Parameters<typeof makeStore>[1]) =>
  (opened = makeStore([fakeProvider('plugin', [...docker, installed, fonts]).provider], opts))

const compose = { content: 'services:\n  web:\n    image: docker/web', priority: 100 }

describe('recommendations from what the person works on', () => {
  test('what is open picks listings by meaning: ten at most, none already installed', async () => {
    const { store } = storeOf({ meaning: meaning(), context: async () => [compose] })

    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)).toEqual(docker.slice(0, 10).map((listing) => listing.ref.id))
  })

  test('a file the person linked is read before a large tab that is only open', async () => {
    const asked: string[] = []
    const ambient = { content: 'font '.repeat(4_000), priority: -300 }
    const { store } = storeOf({
      meaning: meaning(asked),
      context: async () => [ambient, compose],
    })

    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)).toContain('docker-1')
    expect(asked[0]!.length).toBeLessThan(4_000)
  })

  test('without meaning the row is still full: trusted packages by score, none installed', async () => {
    const { store } = storeOf({ context: async () => [{ content: 'Containers', priority: 1 }] })

    const answer = await store.recommend(actor, { references: [] })

    expect(answer.listings).toHaveLength(10)
    expect(ids(answer.listings)).not.toContain('docker-installed')
    expect(answer.matched).toBe(0)
    expect(answer.strategy.mode).toBe('lexical')
  })

  test('what meaning finds comes first, and trusted packages fill the rest of the ten', async () => {
    const { store } = storeOf({
      meaning: meaning(),
      context: async () => [{ content: 'font pairing', priority: 1 }],
    })

    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('fonts')
    expect(answer.matched).toBe(1)
    expect(answer.listings).toHaveLength(10)
    expect(new Set(ids(answer.listings)).size).toBe(10)
  })

  test('with nothing open, the project itself is the context', async () => {
    const { store } = storeOf({
      meaning: meaning(),
      context: async () => [],
      projectWords: ['docker'],
    })

    const answer = await store.recommend(actor, { projectId: 'p1', references: [] })

    expect(ids(answer.listings)[0]).toBe('docker-1')
  })

  test('what the person installed counts as what they work on', async () => {
    const desktop = makeListing({
      id: 'docker-desktop',
      kind: 'plugin',
      displayName: 'Docker desktop',
      summary: 'Run docker containers',
      tags: [],
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    })
    opened = makeStore([fakeProvider('plugin', [...docker, desktop, fonts]).provider], {
      meaning: meaning(),
      context: async () => [],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('docker-1')
    expect(ids(answer.listings)).not.toContain('docker-desktop')
  })

  test('a package that comes with Localix is no choice the person made', async () => {
    const bundled = makeListing({
      id: 'fonts-bundled',
      kind: 'plugin',
      summary: 'font tools',
      tags: [],
      bundled: true,
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    })
    opened = makeStore([fakeProvider('plugin', [...docker, bundled, fonts]).provider], {
      meaning: meaning(),
      context: async () => [],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(answer.matched).toBe(0)
  })

  test('each interest is asked on its own, so a busy file cannot crowd out what the person uses', async () => {
    const asked: string[] = []
    const pen = makeListing({
      id: 'pen',
      kind: 'plugin',
      displayName: 'Pen',
      summary: 'A font editor',
      tags: [],
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    })
    opened = makeStore([fakeProvider('plugin', [...docker, pen, fonts]).provider], {
      meaning: meaning(asked),
      context: async () => [compose],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings.slice(0, answer.matched))).toContain('fonts')
    expect(asked.some((text) => text.includes('docker') && text.includes('font'))).toBe(false)
  })

  test('every recommendation says why: the tab, the install, or a trusted pick that fills', async () => {
    const pen = makeListing({
      id: 'pen',
      kind: 'plugin',
      displayName: 'Pen',
      summary: 'A font editor',
      tags: [],
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    })
    opened = makeStore([fakeProvider('plugin', [...docker.slice(0, 3), pen, fonts]).provider], {
      meaning: meaning(),
      context: async () => [{ ...compose, label: 'compose.yaml', linked: false }],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(answer.reasons['plugin:docker-1']).toEqual({ source: 'open', label: 'compose.yaml' })
    expect(answer.reasons['plugin:fonts']).toEqual({ source: 'installed', label: 'Pen' })
    const filler = answer.listings.slice(answer.matched)
    expect(filler.map((listing) => answer.reasons[`plugin:${listing.ref.id}`])).toEqual(
      filler.map(() => ({ source: 'trusted' })),
    )
  })

  test('one publisher does not take the whole row while others suit the work too', async () => {
    const kube = Array.from({ length: 3 }, (_, at) =>
      makeListing({
        id: `kube-${at + 1}`,
        kind: 'plugin',
        summary: 'Clusters',
        tags: [],
        publisher: { name: 'Kube', verified: true },
      }),
    )
    opened = makeStore([fakeProvider('plugin', [...docker, ...kube]).provider], {
      meaning: (text) => [
        ...meaning()(text),
        ...(text.includes('docker')
          ? kube.map((listing, at) => ({ key: `plugin:${listing.ref.id}`, z: 2.6 - at / 10 }))
          : []),
      ],
      context: async () => [compose],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings.slice(0, 3))).toContain('kube-1')
  })

  test('what the person is not interested in is never recommended, until they take it back', async () => {
    const { store } = storeOf({ meaning: meaning(), context: async () => [compose] })
    const ref = { kind: 'plugin' as const, id: 'docker-1' }

    await store.dismissRecommendation(actor, ref, true)
    const without = await store.recommend(actor, { references: [] })
    await store.dismissRecommendation(actor, ref, false)
    const back = await store.recommend(actor, { references: [] })

    expect(ids(without.listings)).not.toContain('docker-1')
    expect(without.listings).toHaveLength(10)
    expect(ids(back.listings)[0]).toBe('docker-1')
  })

  test('a package the person removes through the Store is not recommended to them again', async () => {
    const { store } = storeOf({ meaning: meaning(), context: async () => [compose] })

    await store.remove({ kind: 'plugin', id: 'docker-1' }, 'user', actor)
    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)).not.toContain('docker-1')
  })

  test('what was turned down is listed with why, newest first, and taken back from there', async () => {
    const { store } = storeOf({ meaning: meaning(), context: async () => [compose] })
    let pokes = 0
    store.subscribeRecommendations(() => (pokes += 1))

    await store.dismissRecommendation(actor, { kind: 'plugin', id: 'docker-1' }, true)
    await store.remove({ kind: 'plugin', id: 'docker-2' }, 'user', actor)
    const listed = await store.dismissedRecommendations(actor)
    await store.dismissRecommendation(actor, { kind: 'plugin', id: 'docker-1' }, false)

    expect(listed.map((item) => [item.listing.ref.id, item.reason])).toEqual([
      ['docker-2', 'removed'],
      ['docker-1', 'not-interested'],
    ])
    expect(
      (await store.dismissedRecommendations(actor)).map((item) => item.listing.ref.id),
    ).toEqual(['docker-2'])
    expect(pokes).toBe(2)
  })

  test('not interested leaves the remembered answer at once, before it is worked out again', async () => {
    const later: Array<() => void> = []
    const { store } = storeOf({
      meaning: meaning(),
      context: async () => [compose],
      schedule: (run) => {
        later.push(run)
        return () => {}
      },
    })
    const where = { projectId: 'p1', sessionId: 's1' }
    store.reportWorkingSet(actor, { ...where, references: [] })
    for (const run of later.splice(0)) run()
    await store.recommendationsSettled()
    let pokes = 0
    store.subscribeRecommendations(() => (pokes += 1))

    await store.dismissRecommendation(actor, { kind: 'plugin', id: 'docker-1' }, true)
    const read = await store.readRecommendations(actor, where)

    expect(ids(read.listings)).not.toContain('docker-1')
    expect(pokes).toBe(1)
    expect(later.length).toBeGreaterThan(0)
  })

  test('what the person installed finds its like by what it is, not by how its summary reads', async () => {
    const pen = makeListing({
      id: 'pen',
      kind: 'plugin',
      displayName: 'Pen',
      summary: 'A glyph tool',
      tags: [],
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    })
    opened = makeStore([fakeProvider('plugin', [...docker, pen, fonts]).provider], {
      meaning: meaning(),
      itemMeaning: (members) =>
        members.some((member) => member.key === 'plugin:pen')
          ? [{ key: 'plugin:fonts', z: 3 }]
          : [],
      context: async () => [],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('fonts')
    expect(answer.reasons['plugin:fonts']).toEqual({ source: 'installed', label: 'Pen' })
  })

  test('what is like the installs counts though it does not stand out as an answer would', async () => {
    opened = makeStore([fakeProvider('plugin', [...docker, installed, fonts]).provider], {
      meaning: meaning(),
      itemMeaning: () => [
        { key: 'plugin:docker-1', z: 1.5 },
        { key: 'plugin:fonts', z: 0.5 },
      ],
      context: async () => [],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings.slice(0, answer.matched))).toEqual(['docker-1'])
  })

  test('a tab is asked about by its name first, then what it holds', async () => {
    const asked: string[] = []
    const { store } = storeOf({
      meaning: meaning(asked),
      context: async () => [{ ...compose, label: 'compose.yaml' }],
    })

    await store.recommend(actor, { references: [] })

    expect(asked[0]).toStartWith('compose.yaml\nservices:')
  })

  test('what the person installed lately counts for more than what they installed long ago', async () => {
    const installed = (id: string, displayName: string, category: string) =>
      makeListing({
        id,
        kind: 'plugin',
        displayName,
        summary: displayName,
        category,
        tags: [],
        installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
      })
    const old = installed('pen', 'Pen', 'Design')
    const recent = installed('box', 'Box', 'Development')
    opened = makeStore([fakeProvider('plugin', [...docker, old, recent, fonts]).provider], {
      meaning: meaning(),
      itemMeaning: (members) =>
        members.some((member) => member.key === 'plugin:box')
          ? [{ key: 'plugin:docker-1', z: 3 }]
          : [{ key: 'plugin:fonts', z: 3 }],
      context: async () => [],
    })
    await opened.store.install(recent.ref, 'user', { plan: true }, actor)

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings).slice(0, 2)).toEqual(['docker-1', 'fonts'])
  })

  test('a package made for the file that is open leads, whatever its summary says', async () => {
    const tf = makeListing({
      id: 'tf',
      kind: 'plugin',
      summary: 'Plans',
      tags: [],
      suggestFor: { files: ['*.tf'] },
    })
    opened = makeStore([fakeProvider('plugin', [...docker, tf]).provider], {
      meaning: meaning(),
      context: async () => [{ ...compose, label: 'main.tf' }],
    })

    const answer = await opened.store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('tf')
    expect(answer.reasons['plugin:tf']).toEqual({ source: 'open', label: 'main.tf' })
  })

  test('a package made for what the project depends on is recommended for it', async () => {
    const orm = makeListing({
      id: 'orm',
      kind: 'plugin',
      summary: 'Schemas',
      tags: [],
      suggestFor: { dependencies: ['prisma'] },
    })
    opened = makeStore([fakeProvider('plugin', [...docker, orm]).provider], {
      meaning: meaning(),
      projectFacts: { files: ['package.json'], dependencies: ['prisma'] },
      context: async () => [],
    })

    const answer = await opened.store.recommend(actor, { references: [], projectId: 'p1' })

    expect(ids(answer.listings)[0]).toBe('orm')
    expect(answer.reasons['plugin:orm']).toEqual({ source: 'project', label: 'prisma' })
  })

  test('a package shown on three days and never opened gives its place to the next', async () => {
    let now = TEST_NOW
    const { store } = storeOf({
      meaning: meaning(),
      context: async () => [compose],
      now: () => now,
    })
    const shown = { ref: { kind: 'plugin' as const, id: 'docker-1' }, event: 'shown' as const }
    for (const day of [0, 1, 2]) {
      now = TEST_NOW + day * DAY
      await store.recordRecommendationEvents(actor, [{ ...shown, slot: 0, source: 'open' }])
      await store.recordRecommendationEvents(actor, [{ ...shown, slot: 0, source: 'open' }])
    }

    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('docker-2')
  })

  test('opened once, it keeps its place however often it was shown', async () => {
    let now = TEST_NOW
    const { store } = storeOf({
      meaning: meaning(),
      context: async () => [compose],
      now: () => now,
    })
    const ref = { kind: 'plugin' as const, id: 'docker-1' }
    for (const day of [0, 1, 2]) {
      now = TEST_NOW + day * DAY
      await store.recordRecommendationEvents(actor, [{ ref, event: 'shown', slot: 0 }])
    }
    await store.recordRecommendationEvents(actor, [{ ref, event: 'opened', slot: 0 }])

    const answer = await store.recommend(actor, { references: [] })

    expect(ids(answer.listings)[0]).toBe('docker-1')
  })

  test('an install of what was recommended counts for what found it', async () => {
    const { store } = storeOf({ meaning: meaning(), context: async () => [compose] })
    const ref = { kind: 'plugin' as const, id: 'docker-1' }
    await store.recordRecommendationEvents(actor, [
      { ref, event: 'shown', slot: 0, source: 'open' },
      { ref, event: 'opened', slot: 0, source: 'open' },
      { ref: { kind: 'plugin', id: 'docker-2' }, event: 'shown', slot: 1, source: 'open' },
    ])

    await store.install(ref, 'user', { plan: true }, actor)
    await store.install({ kind: 'plugin', id: 'fonts' }, 'user', { plan: true }, actor)

    expect(await store.recommendationStats(actor)).toEqual({
      open: { shown: 2, opened: 1, installed: 1 },
    })
  })

  test('the routes take the working set, then answer it once it is worked out', async () => {
    const seen: unknown[] = []
    const later: Array<() => void> = []
    const { store } = storeOf({
      meaning: meaning(),
      context: async (_userId, request) => {
        seen.push(request)
        return [compose]
      },
      schedule: (run) => {
        later.push(run)
        return () => {}
      },
    })
    const root = new Hono<AppContext>()
    root.use('*', async (c, next) => {
      c.set('userId', 'u1')
      await next()
    })
    root.route('/rpc/store', createStoreRoutes(store))
    const tab = { kind: 'file', token: '@file:compose.yaml', label: 'compose.yaml' }

    const reported = await root.request('/rpc/store/recommendations/working-set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1', sessionId: 's1', references: [tab] }),
    })
    expect(reported.status).toBe(202)
    for (const run of later.splice(0)) run()
    await store.recommendationsSettled()

    const read = await root.request('/rpc/store/recommendations?projectId=p1&sessionId=s1')
    expect(read.status).toBe(200)
    expect(seen).toEqual([{ projectId: 'p1', sessionId: 's1', references: [tab] }])
    const body = (await read.json()) as { listings: Listing[]; pending: boolean }
    expect(body.pending).toBe(false)
    expect(ids(body.listings)).toEqual(docker.slice(0, 10).map((listing) => listing.ref.id))

    const dismissed = await root.request('/rpc/store/recommendations/dismissals', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: { kind: 'plugin', id: 'docker-1' }, dismissed: true }),
    })
    expect(dismissed.status).toBe(204)
    const events = await root.request('/rpc/store/recommendations/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: [
          { ref: { kind: 'plugin', id: 'docker-2' }, event: 'shown', slot: 0, source: 'open' },
        ],
      }),
    })
    expect(events.status).toBe(202)
    const stats = await root.request('/rpc/store/recommendations/stats')
    expect(await stats.json()).toEqual({ sources: { open: { shown: 1, opened: 0, installed: 0 } } })
    const turned = await root.request('/rpc/store/recommendations/dismissals')
    expect(turned.status).toBe(200)
    const body2 = (await turned.json()) as { dismissed: Array<{ listing: Listing }> }
    expect(body2.dismissed.map((item) => item.listing.ref.id)).toEqual(['docker-1'])
    const after = await root.request('/rpc/store/recommendations?projectId=p1&sessionId=s1')
    expect(ids(((await after.json()) as { listings: Listing[] }).listings)).not.toContain(
      'docker-1',
    )
  })
})
