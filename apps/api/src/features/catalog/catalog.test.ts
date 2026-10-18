import { describe, expect, test } from 'bun:test'

import type { CatalogResponse } from './contracts'
import { createCatalogService } from './service'

const catalog: CatalogResponse = {
  providers: [
    {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      modelCount: 1,
      authType: 'oauth-pkce',
    },
  ],
  models: [
    {
      id: 'openai-codex/gpt-5',
      name: 'GPT-5',
      providerId: 'openai-codex',
      providerName: 'OpenAI Codex',
      supportsTools: true,
      supportsReasoning: true,
      supportsAttachment: true,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
    },
  ],
  oauthProviderIds: ['openai-codex'],
  oauthProviders: [
    {
      providerId: 'openai-codex',
      loginLabel: 'ChatGPT',
      loginDescription: 'Sign in with ChatGPT',
    },
  ],
}

describe('runtime catalog facade', () => {
  test('returns the adapter catalog without host-side merging', async () => {
    const service = createCatalogService({ source: { list: () => catalog } })
    expect(await service.getCatalog()).toEqual(catalog)
  })

  test('orders runtime models by newest release with deterministic undated fallbacks', async () => {
    const base = catalog.models[0]
    const service = createCatalogService({
      source: {
        list: () => ({
          ...catalog,
          models: [
            { ...base, id: 'z/undated', name: 'Zulu', providerId: 'z' },
            { ...base, id: 'a/older', name: 'Older', providerId: 'a', releaseDate: '2024-01-01' },
            { ...base, id: 'b/newer', name: 'Newer', providerId: 'b', releaseDate: '2025-01-01' },
            { ...base, id: 'a/invalid', name: 'Alpha', providerId: 'a', releaseDate: 'n/a' },
          ],
        }),
      },
    })

    expect((await service.getCatalog()).models.map(({ id }) => id)).toEqual([
      'b/newer',
      'a/older',
      'z/undated',
      'a/invalid',
    ])
  })

  test('does not reinterpret opaque ids when release metadata is missing', async () => {
    const base = catalog.models[0]
    const sourceModels = [
      { ...base, id: 'provider/latest', providerId: 'provider' },
      { ...base, id: 'provider/model-9', providerId: 'provider' },
      { ...base, id: 'provider/model-10', providerId: 'provider' },
    ]
    const service = createCatalogService({
      source: { list: () => ({ ...catalog, models: sourceModels }) },
    })

    expect((await service.getCatalog()).models).toEqual(sourceModels)
  })

  test('orders OAuth-capable providers first without changing newest-first model order', async () => {
    const baseProvider = catalog.providers[0]
    const baseModel = catalog.models[0]
    const service = createCatalogService({
      source: {
        list: () => ({
          ...catalog,
          providers: [
            {
              ...baseProvider,
              id: 'key-only',
              name: 'Key only',
              authType: 'api-key',
            },
            {
              ...baseProvider,
              id: 'mixed',
              name: 'Mixed',
              authType: 'api-key',
            },
            { ...baseProvider, id: 'oauth', name: 'OAuth' },
          ],
          models: [
            {
              ...baseModel,
              id: 'oauth/older',
              providerId: 'oauth',
              releaseDate: '2024-01-01',
            },
            {
              ...baseModel,
              id: 'key-only/newer',
              providerId: 'key-only',
              releaseDate: '2025-01-01',
            },
          ],
          oauthProviderIds: ['mixed', 'oauth'],
        }),
      },
    })

    const result = await service.getCatalog()
    expect(result.providers.map(({ id }) => id)).toEqual(['mixed', 'oauth', 'key-only'])
    expect(result.models.map(({ id }) => id)).toEqual(['key-only/newer', 'oauth/older'])
  })

  test('deduplicates concurrent loads and caches the resolved catalog', async () => {
    let loads = 0
    const service = createCatalogService({
      source: {
        async list() {
          loads += 1
          await Promise.resolve()
          return catalog
        },
      },
    })

    const [first, second] = await Promise.all([service.getCatalog(), service.getCatalog()])
    expect(first).toBe(second)
    expect(await service.getCatalog()).toBe(first)
    expect(loads).toBe(1)
  })

  test('warm starts the same cached load used by requests', async () => {
    let loads = 0
    const service = createCatalogService({
      source: {
        list() {
          loads += 1
          return catalog
        },
      },
    })

    service.warm()
    await Promise.resolve()
    expect(await service.getCatalog()).toEqual(catalog)
    expect(loads).toBe(1)
  })

  test('a failed warm-up is reported, not left unhandled, and the next read retries', async () => {
    const reported: unknown[] = []
    let fail = true
    const service = createCatalogService({
      source: {
        list() {
          if (fail) throw new Error('adapter not ready')
          return catalog
        },
      },
      onWarmError: (error) => reported.push(error),
    })

    service.warm()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reported).toHaveLength(1)

    fail = false
    expect(await service.getCatalog()).toEqual(catalog)
  })
})

describe('contributed model kinds', () => {
  test('a source adds models of another kind to the full catalog; the chat view leaves them out', async () => {
    const service = createCatalogService({ source: { list: () => catalog } })
    service.registerModelSource({
      id: 'embeddings',
      list: async () => [
        {
          ...catalog.models[0]!,
          id: 'openai-codex/text-embedding',
          name: 'Embedding',
          kind: 'embedding' as const,
          outputModalities: ['embedding'],
        },
      ],
    })
    expect((await service.getFullCatalog()).models.map((m) => m.id)).toEqual([
      'openai-codex/gpt-5',
      'openai-codex/text-embedding',
    ])
    expect((await service.getCatalog()).models.map((m) => m.id)).toEqual(['openai-codex/gpt-5'])
  })
})
