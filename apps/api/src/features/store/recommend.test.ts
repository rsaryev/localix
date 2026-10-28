import { afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { Listing } from '@localixai/store'

import type { AppContext } from '../../app'
import { createStoreRoutes } from './routes'
import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'

const actor = { userId: 'u1' }
let opened: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})
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
  })
})
