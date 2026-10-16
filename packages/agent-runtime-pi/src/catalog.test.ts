import { describe, expect, test } from 'bun:test'
import type { Model } from '@earendil-works/pi-ai'
import { GeneratedCatalogRefresher } from '@earendil-works/pi-ai/generated-catalog'

import type { EngineCatalogStore } from '@localixai/agent/runtime'

import {
  fixtureFetch,
  GENERATED_CATALOG_DOCUMENTS,
  MODELS_DEV_URL,
} from './__fixtures__/generated-catalog-documents'
import { createPiCatalog } from './catalog'
import { createPiModelsStore, piCatalogBuild } from './catalog-store'
import { createPiProviders } from './providers'

function memoryStore(): EngineCatalogStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>()
  return {
    entries,
    read: async (providerId) => structuredClone(entries.get(providerId)),
    write: async (providerId, entry) => {
      entries.set(providerId, structuredClone(entry))
    },
    delete: async (providerId) => {
      entries.delete(providerId)
    },
  }
}

function chatModel(provider: string, id: string): Model<'openai-responses'> {
  return {
    id,
    name: id,
    api: 'openai-responses',
    provider,
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  }
}

function catalogWith(
  options: {
    store?: EngineCatalogStore
    fetch?: typeof fetch
    now?: () => number
    reuseWithinMs?: number
  } = {},
) {
  const refresher = new GeneratedCatalogRefresher({
    fetch: options.fetch ?? fixtureFetch().fetch,
    ...(options.now ? { now: options.now } : {}),
    ...(options.reuseWithinMs !== undefined ? { reuseWithinMs: options.reuseWithinMs } : {}),
  })
  return createPiCatalog({
    providers: createPiProviders(refresher),
    ...(options.store ? { store: options.store } : {}),
  })
}

const ids = async (catalog: ReturnType<typeof createPiCatalog>) =>
  (await catalog.list()).models.map((model) => model.id)

describe('catalog store', () => {
  test('round-trips an entry under the current build', async () => {
    const host = memoryStore()
    const store = createPiModelsStore(host)
    const entry = { models: [chatModel('openai', 'gpt-stored')], checkedAt: 5 }

    await store.write('openai', entry)

    expect(host.entries.get('openai')).toEqual({ build: piCatalogBuild(), entry })
    expect(await store.read('openai')).toEqual(entry)
  })

  test('drops and removes entries pi’s schema rejects or another build wrote', async () => {
    const host = memoryStore()
    const dropped: string[] = []
    const store = createPiModelsStore(host, { onDropped: (providerId) => dropped.push(providerId) })
    const build = piCatalogBuild()
    host.entries.set('invalid', {
      build,
      entry: { models: [{ ...chatModel('invalid', 'x'), contextWindow: 'large' }] },
    })
    host.entries.set('old', { build: 'generated-0', entry: { models: [chatModel('old', 'x')] } })
    host.entries.set('garbage', 'not an entry')

    for (const providerId of ['invalid', 'old', 'garbage']) {
      expect(await store.read(providerId)).toBeUndefined()
    }
    expect(dropped).toEqual(['invalid', 'old', 'garbage'])
    expect([...host.entries.keys()]).toEqual([])
  })

  test('treats an unreadable entry as absent', async () => {
    const host = memoryStore()
    host.read = async () => {
      throw new Error('corrupt')
    }
    expect(await createPiModelsStore(host).read('openai')).toBeUndefined()
  })
})

describe('catalog refresh', () => {
  test('an offline start restores the persisted catalog without a request', async () => {
    const host = memoryStore()
    await createPiModelsStore(host).write('openai', {
      models: [chatModel('openai', 'gpt-restored')],
      checkedAt: Date.now(),
    })
    const { fetch, requests } = fixtureFetch()
    const catalog = catalogWith({ store: host, fetch })
    expect(await ids(catalog)).not.toContain('openai/gpt-restored')

    const result = await catalog.refresh({ allowNetwork: false })

    expect(result).toEqual({ changed: true, aborted: false, errors: [] })
    expect(await ids(catalog)).toContain('openai/gpt-restored')
    expect(requests).toEqual([])
  })

  test('a network refresh publishes the generated models and invalidates the cached list', async () => {
    const host = memoryStore()
    const catalog = catalogWith({ store: host })
    const before = await catalog.list()
    expect(before.models.map((model) => model.id)).not.toContain('openai/gpt-fixture-1')

    const result = await catalog.refresh({ allowNetwork: true })

    expect(result.changed).toBe(true)
    expect(result.errors).toEqual([])
    const after = await catalog.list()
    const model = after.models.find((entry) => entry.id === 'openai/gpt-fixture-1')
    expect(model).toMatchObject({ releaseDate: '2099-01-02', contextLength: 128000 })
    expect(model?.reasoningEfforts).toEqual(['off', 'low', 'medium', 'high'])
    // The baseline stays under the overlay: a refresh adds and updates, it does not remove.
    expect(after.models.length).toBeGreaterThan(before.models.length)
    expect(host.entries.get('openai')).toMatchObject({ build: piCatalogBuild() })
    // Radius's list is per account; the host never refreshes it.
    expect(host.entries.has('radius')).toBe(false)
  })

  test('a later launch restores what the refresh persisted', async () => {
    const host = memoryStore()
    await catalogWith({ store: host }).refresh({ allowNetwork: true })
    const { fetch, requests } = fixtureFetch({ fail: true })

    const relaunched = catalogWith({ store: host, fetch })
    await relaunched.refresh({ allowNetwork: false })

    expect(await ids(relaunched)).toContain('openai/gpt-fixture-1')
    expect(requests).toEqual([])
  })

  test('a fresh persisted catalog is not fetched again unless forced', async () => {
    const host = memoryStore()
    await catalogWith({ store: host }).refresh({ allowNetwork: true })
    const { fetch, requests } = fixtureFetch()
    const catalog = catalogWith({ store: host, fetch })

    expect((await catalog.refresh({ allowNetwork: true })).errors).toEqual([])
    expect(requests).toEqual([])

    await catalog.refresh({ allowNetwork: true, force: true })
    expect(requests.length).toBeGreaterThan(0)
  })

  test('a failed refresh keeps the previous list and reports each provider', async () => {
    const host = memoryStore()
    await catalogWith({ store: host }).refresh({ allowNetwork: true })
    const catalog = catalogWith({ store: host, fetch: fixtureFetch({ fail: true }).fetch })
    await catalog.refresh({ allowNetwork: false })
    const before = await ids(catalog)

    const result = await catalog.refresh({ allowNetwork: true, force: true })

    expect(result.errors.length).toBeGreaterThan(0)
    expect(new Set(result.errors.map((error) => error.message))).toEqual(new Set(['offline']))
    expect(await ids(catalog)).toEqual(before)
    expect(before).toContain('openai/gpt-fixture-1')
  })

  test('an unchanged models.dev answers 304 and the catalog stays the same', async () => {
    const etag = '"models-dev-1"'
    const { fetch, requests } = fixtureFetch({ etags: { [MODELS_DEV_URL]: etag } })
    let now = 1_000
    const catalog = catalogWith({ fetch, now: () => now, reuseWithinMs: 10 })
    await catalog.refresh({ allowNetwork: true })
    const first = await ids(catalog)
    requests.length = 0

    now += 1_000
    const result = await catalog.refresh({ allowNetwork: true, force: true })

    expect(result.errors).toEqual([])
    const modelsDev = requests.filter((request) => request.url === MODELS_DEV_URL)
    expect(modelsDev).toHaveLength(1)
    expect(modelsDev[0]?.headers['if-none-match']).toBe(etag)
    expect(await ids(catalog)).toEqual(first)
  })

  test('a document the generator would reject fails the whole refresh', async () => {
    const documents = { ...GENERATED_CATALOG_DOCUMENTS }
    delete documents['https://ai-gateway.vercel.sh/v1/models']
    const catalog = catalogWith({ fetch: fixtureFetch({ documents }).fetch })

    const result = await catalog.refresh({ allowNetwork: true })

    expect(result.changed).toBe(false)
    expect(result.errors[0]?.message).toBe('Vercel AI Gateway API returned 404')
    expect(await ids(catalog)).not.toContain('openai/gpt-fixture-1')
  })
})
