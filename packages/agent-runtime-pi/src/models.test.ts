import { beforeEach, describe, expect, test } from 'bun:test'

import { resetCatalogMetadataRefreshState, settleCatalogMetadataRefresh } from './catalog-metadata'
import { createPiModels, listPiCatalog, type PiCatalogOptions } from './models'
import type { CatalogMetadataSnapshot } from './models'

// Several launches run through one module instance here; the refresh throttle is per process.
beforeEach(() => resetCatalogMetadataRefreshState())

/** The catalog once the refresh this read started has landed — nothing in the product waits. */
async function afterRefresh(options: PiCatalogOptions) {
  await listPiCatalog(options)
  await settleCatalogMetadataRefresh()
  return listPiCatalog(options)
}

function openAiModelId(): string {
  const models = createPiModels(
    { providerId: 'openai', modelId: 'unused' },
    { type: 'api-key', key: 'discovery' },
  )
  const model = models.getModels('openai')[0]
  if (!model) throw new Error('Pi OpenAI catalog is empty')
  return model.id
}

/**
 * A real OpenRouter model id from the native catalog, without the `openrouter/` prefix. Read off
 * the provider rather than the catalog, so it starts no metadata refresh of its own.
 */
async function openRouterRawModelId(): Promise<string> {
  const models = createPiModels(
    { providerId: 'openrouter', modelId: 'unused' },
    { type: 'api-key', key: 'discovery' },
  )
  const model = models.getModels('openrouter')[0]
  if (!model) throw new Error('Pi OpenRouter catalog is empty')
  return model.id
}

describe('pi catalog metadata', () => {
  test('enriches existing OpenRouter models with authoritative release timestamps', async () => {
    const rawId = await openRouterRawModelId()

    const enriched = await afterRefresh({
      fetch: async () =>
        Response.json({ data: [{ id: rawId, created: Date.UTC(2026, 6, 19) / 1000 }] }),
    })

    expect(enriched.models.find((entry) => entry.id === `openrouter/${rawId}`)?.releaseDate).toBe(
      '2026-07-19T00:00:00.000Z',
    )
  })

  test('a model runs at the levels its provider publishes, not the generated ones', async () => {
    // The generated snapshot in `vendor/pi` is built from this same field and then frozen, so it
    // goes stale the moment a vendor changes a model: the picker offered `xhigh` for a DeepSeek
    // model whose provider lists low/high/max, and hid the three it does have.
    const rawId = await openRouterRawModelId()
    const catalog = await afterRefresh({
      fetch: async () =>
        Response.json({
          data: [
            {
              id: rawId,
              reasoning: { mandatory: false, supported_efforts: ['low', 'high', 'max'] },
            },
          ],
        }),
    })

    const model = catalog.models.find((entry) => entry.id === `openrouter/${rawId}`)
    expect(model?.supportsReasoning).toBe(true)
    expect(model?.reasoningEfforts).toEqual(['low', 'high', 'max'])
  })

  test('a provider that publishes nothing leaves the generated levels alone', async () => {
    const rawId = await openRouterRawModelId()
    const generated = await listPiCatalog({
      fetch: async () => new Response(null, { status: 503 }),
    })
    const before = generated.models.find((entry) => entry.id === `openrouter/${rawId}`)

    resetCatalogMetadataRefreshState()
    const catalog = await afterRefresh({
      fetch: async () => Response.json({ data: [{ id: rawId, created: 1_700_000_000 }] }),
    })

    expect(
      catalog.models.find((entry) => entry.id === `openrouter/${rawId}`)?.reasoningEfforts,
    ).toEqual(before?.reasoningEfforts)
  })

  test('keeps the full native catalog when release metadata is unavailable', async () => {
    const catalog = await listPiCatalog({
      fetch: async () => {
        throw new Error('offline')
      },
    })

    expect(catalog.models.length).toBeGreaterThan(0)
    expect(catalog.providers.length).toBeGreaterThan(0)
  })

  test('returns isolated DTOs from the cached native catalog projection', async () => {
    const first = await listPiCatalog({
      fetch: async () => new Response(null, { status: 503 }),
    })
    const expectedName = first.models[0]?.name
    if (!first.models[0] || !expectedName) throw new Error('Pi catalog is empty')
    first.models[0].name = 'caller mutation'

    const second = await listPiCatalog({
      fetch: async () => new Response(null, { status: 503 }),
    })

    expect(second.models[0]?.name).toBe(expectedName)
  })
})

describe('pi run model collection', () => {
  test('registers only the selected shared provider and keeps credentials request-scoped', async () => {
    const modelId = openAiModelId()
    const first = createPiModels(
      { providerId: 'openai', modelId },
      { type: 'api-key', key: 'key-first' },
    )
    const second = createPiModels(
      { providerId: 'openai', modelId },
      { type: 'api-key', key: 'key-second' },
    )
    const firstModel = first.getModel('openai', modelId)
    const secondModel = second.getModel('openai', modelId)
    if (!firstModel || !secondModel) throw new Error('Pi OpenAI model is unavailable')

    expect(first).not.toBe(second)
    expect(first.getProviders()).toHaveLength(1)
    expect(second.getProviders()).toHaveLength(1)
    expect(first.getProvider('openai')).toBe(second.getProvider('openai'))
    expect(first.getAuth(firstModel)).resolves.toMatchObject({ auth: { apiKey: 'key-first' } })
    expect(second.getAuth(secondModel)).resolves.toMatchObject({ auth: { apiKey: 'key-second' } })
  })
})

/**
 * The release-date fetch is the whole cost of the first `/rpc/models/catalog`
 * (measured: 774 ms networked, the full timeout offline) and it only orders a list,
 * so a launch must wait for it at most once. These pin the four ways that goes wrong.
 */
describe('pi catalog metadata store', () => {
  const makeStore = (initial?: CatalogMetadataSnapshot) => {
    let held = initial
    const writes: CatalogMetadataSnapshot[] = []
    return {
      writes,
      read: () => held,
      write: (snapshot: CatalogMetadataSnapshot) => {
        held = snapshot
        writes.push(snapshot)
      },
    }
  }

  test('persists what it fetched so the next run has it', async () => {
    const store = makeStore()
    let fetches = 0
    await listPiCatalog({
      metadataStore: store,
      now: () => 1_000,
      fetch: async () => {
        fetches += 1
        return Response.json({ data: [{ id: 'some/model', created: Date.UTC(2026, 0, 2) / 1000 }] })
      },
    })
    await settleCatalogMetadataRefresh()
    expect(fetches).toBe(1)
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]!.fetchedAt).toBe(1_000)
    expect(store.writes[0]!.releaseDates['openrouter/some/model']).toBe('2026-01-02T00:00:00.000Z')
  })

  test('a snapshot never decides freshness — the provider is asked anyway', async () => {
    // Age used to gate this, and it failed twice in one day: it hid newly published levels for a
    // day, then called a two-hour-old snapshot from the PREVIOUS BUILD fresh. What a snapshot is
    // for is the first frame and an offline machine, not for deciding what is current.
    const store = makeStore({ fetchedAt: 1_000, releaseDates: {}, thinkingLevels: {} })
    let fetches = 0
    await listPiCatalog({
      metadataStore: store,
      now: () => 1_000 + 60_000,
      fetch: async () => {
        fetches += 1
        return Response.json({ data: [] })
      },
    })
    expect(fetches).toBe(1)
  })

  test('opening the catalog repeatedly does not re-ask within the interval', async () => {
    const store = makeStore({ fetchedAt: 1_000, releaseDates: {}, thinkingLevels: {} })
    let fetches = 0
    const options = {
      metadataStore: store,
      now: () => 1_000,
      fetch: async () => {
        fetches += 1
        return Response.json({ data: [] })
      },
    }
    await listPiCatalog(options)
    await listPiCatalog(options)
    await listPiCatalog(options)
    expect(fetches).toBe(1)
  })

  test('a stale snapshot is served immediately; the refresh lands for the next run', async () => {
    const rawId = await openRouterRawModelId()
    const store = makeStore({
      fetchedAt: 0,
      releaseDates: { [`openrouter/${rawId}`]: '2020-01-01T00:00:00.000Z' },
    })
    let released: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => {
      released = resolve
    })
    const catalog = await listPiCatalog({
      metadataStore: store,
      now: () => 25 * 60 * 60 * 1_000,
      // Never settles until we say so: if the caller awaited the refresh, the
      // `await` above could not have returned.
      fetch: async () => {
        await inFlight
        return Response.json({ data: [{ id: rawId, created: Date.UTC(2026, 0, 2) / 1000 }] })
      },
    })
    expect(catalog.models.find((entry) => entry.id === `openrouter/${rawId}`)?.releaseDate).toBe(
      '2020-01-01T00:00:00.000Z',
    )
    released!()
  })

  test('a failed fetch is not persisted as a fresh empty snapshot', async () => {
    const store = makeStore()
    const catalog = await listPiCatalog({
      metadataStore: store,
      now: () => 1_000,
      fetch: async () => {
        throw new Error('offline')
      },
    })
    await settleCatalogMetadataRefresh()
    expect(store.writes).toHaveLength(0)
    expect(catalog.models.length).toBeGreaterThan(0)
  })

  test('a cached snapshot publishes its levels before the network answers', async () => {
    const rawId = await openRouterRawModelId()
    const store = makeStore({
      fetchedAt: 1_000,
      releaseDates: {},
      // A full map, as `thinkingLevelMapFrom` writes it: pi reads an ABSENT key as "not mapped,
      // pass through", so only an explicit null means the model does not offer that level.
      thinkingLevels: {
        [rawId]: {
          off: 'none',
          minimal: null,
          low: 'low',
          medium: null,
          high: 'high',
          xhigh: null,
          max: null,
        },
      },
    })
    let answer: (() => void) | undefined
    const catalog = await listPiCatalog({
      metadataStore: store,
      now: () => 1_000 + 60_000,
      // Never answers until the assertion ran: the levels can only have come from the snapshot.
      fetch: () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(Response.json({ data: [] }))
        }),
    })
    answer?.()
    expect(catalog.models.find((m) => m.id === `openrouter/${rawId}`)?.reasoningEfforts).toEqual([
      'low',
      'high',
    ])
  })

  test('an unreadable store degrades to the plain fetch path', async () => {
    let fetches = 0
    const catalog = await listPiCatalog({
      metadataStore: {
        read: () => {
          throw new Error('corrupt cache file')
        },
        write: () => {
          throw new Error('read-only home')
        },
      },
      now: () => 1_000,
      fetch: async () => {
        fetches += 1
        return Response.json({ data: [] })
      },
    })
    expect(fetches).toBe(1)
    expect(catalog.models.length).toBeGreaterThan(0)
  })
})
