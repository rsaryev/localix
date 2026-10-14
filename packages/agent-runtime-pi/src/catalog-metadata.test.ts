import { beforeEach, describe, expect, test } from 'bun:test'

import {
  catalogMetadataRevision,
  resetCatalogMetadataRefreshState,
  settleCatalogMetadataRefresh,
} from './catalog-metadata'
import { createPiModels, listPiCatalog } from './models'

beforeEach(() => resetCatalogMetadataRefreshState())

const openRouterRawModelId = (): string => {
  const models = createPiModels(
    { providerId: 'openrouter', modelId: 'unused' },
    { type: 'api-key', key: 'discovery' },
  )
  const model = models.getModels('openrouter')[0]
  if (!model) throw new Error('Pi OpenRouter catalog is empty')
  return model.id
}

/** A fetch that answers only when told to — the shape of a network that drops packets. */
function heldFetch() {
  let answer: ((response: Response) => void) | undefined
  const fetch = () =>
    new Promise<Response>((resolve) => {
      answer = resolve
    })
  return { fetch, answer: (response: Response) => answer?.(response) }
}

describe('catalog metadata never blocks a read on the network', () => {
  test('a first launch with no snapshot serves the generated catalog at once', async () => {
    // With no snapshot, the first catalog read (and the first chat turn, which reads it too) used
    // to wait out the full fetch timeout — and a failed fetch is never persisted, so a machine that
    // could not reach the provider paid it on every launch.
    const held = heldFetch()
    const pending = Symbol('still waiting on the network')
    const first = await Promise.race([
      listPiCatalog({ fetch: held.fetch, metadataStore: { read: () => undefined, write() {} } }),
      new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 250)),
    ])
    held.answer(Response.json({ data: [] }))
    expect(first).not.toBe(pending)
    expect(first === pending ? 0 : first.models.length).toBeGreaterThan(0)
  })

  test('a refresh that lands bumps the revision and reaches the next read of this process', async () => {
    const rawId = openRouterRawModelId()
    const held = heldFetch()
    const options = { fetch: held.fetch }

    const before = await listPiCatalog(options)
    const revision = catalogMetadataRevision()
    expect(before.models.find((m) => m.id === `openrouter/${rawId}`)?.releaseDate).toBeUndefined()

    held.answer(Response.json({ data: [{ id: rawId, created: Date.UTC(2026, 2, 3) / 1000 }] }))
    await settleCatalogMetadataRefresh()

    expect(catalogMetadataRevision()).toBeGreaterThan(revision)
    const after = await listPiCatalog(options)
    expect(after.models.find((m) => m.id === `openrouter/${rawId}`)?.releaseDate).toBe(
      '2026-03-03T00:00:00.000Z',
    )
  })

  test('a failed refresh leaves the revision — and what is served — alone', async () => {
    await listPiCatalog({ fetch: async () => new Response(null, { status: 503 }) })
    const revision = catalogMetadataRevision()
    await settleCatalogMetadataRefresh()
    expect(catalogMetadataRevision()).toBe(revision)
  })
})
