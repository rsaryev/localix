import { describe, expect, test } from 'bun:test'
import { resolveAuxiliaryModel, resolveLanguageModel } from './model-resolution'

const slot = { providerConnectionId: 'conn-1', modelId: 'aux-model' }

// Build deps whose provider-connections service behaves as configured. The happy
// path (a real provider) isn't exercised here — these cover the defensive
// fallbacks that must return null instead of throwing. `listConnections` defaults
// to empty: resolution still tries the slot's stored id first (as a hint), so
// these fallbacks are exercised via that path.
const makeDeps = (svc: Record<string, unknown>) =>
  ({
    providerConnectionsService: { listConnections: async () => ({ connections: [] }), ...svc },
  }) as never

describe('resolveAuxiliaryModel — graceful fallbacks', () => {
  test('retains auxiliary catalog limits and concrete connection identity', async () => {
    const runtimeModel = { ref: { providerId: 'p', modelId: 'aux-model' } }
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections: [{ id: 'conn-1', providerId: 'p' }] }),
        requireConnection: async () => ({ id: 'conn-1' }),
        ensureFreshKeys: async () => ({
          id: 'conn-1',
          providerId: 'p',
          keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      languageModelFactory: { create: () => runtimeModel },
    }
    const resolved = await resolveAuxiliaryModel({
      deps: deps as never,
      userId: 'u',
      slot: { providerConnectionId: 'conn-1', modelId: 'p/aux-model' },
      catalog: {
        providers: [{ id: 'proxy' }, { id: 'p' }],
        models: [
          {
            id: 'aux-model',
            providerId: 'proxy',
            contextLength: 2_000,
            outputLimit: 200,
            outputModalities: ['image'],
          },
          {
            id: 'p/aux-model',
            providerId: 'p',
            contextLength: 16_000,
            outputLimit: 2_000,
            outputModalities: ['text'],
          },
        ],
      } as never,
    })
    expect(resolved).toMatchObject({
      model: runtimeModel,
      providerId: 'p',
      providerConnectionId: 'conn-1',
      contextLength: 16_000,
      outputLimit: 2_000,
      // No level on the slot: the default, never the session's.
      reasoningEffort: 'medium',
    })
  })

  test('an explicit workload effort is used as stored', async () => {
    const runtimeModel = { ref: { providerId: 'p', modelId: 'aux-model' } }
    const resolved = await resolveAuxiliaryModel({
      deps: {
        providerConnectionsService: {
          listConnections: async () => ({ connections: [{ id: 'conn-1', providerId: 'p' }] }),
          requireConnection: async () => ({ id: 'conn-1' }),
          ensureFreshKeys: async () => ({
            id: 'conn-1',
            providerId: 'p',
            keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
          }),
          credentialStoreFor: async () => ({}),
        },
        languageModelFactory: { create: () => runtimeModel },
      } as never,
      userId: 'u',
      slot: { providerConnectionId: 'conn-1', modelId: 'p/aux-model', reasoningEffort: 'low' },
      catalog: {
        providers: [{ id: 'p' }],
        models: [{ id: 'p/aux-model', providerId: 'p', outputModalities: ['text'] }],
      } as never,
    })

    expect(resolved?.reasoningEffort).toBe('low')
  })

  test('a null/absent slot resolves to null without touching deps', async () => {
    expect(
      await resolveAuxiliaryModel({
        deps: {} as never,
        userId: 'u',
        slot: null,
        catalog: {} as never,
      }),
    ).toBeNull()
    expect(
      await resolveAuxiliaryModel({
        deps: {} as never,
        userId: 'u',
        slot: undefined,
        catalog: {} as never,
      }),
    ).toBeNull()
  })

  test('a failing connection lookup is swallowed → null', async () => {
    const deps = makeDeps({
      requireConnection: async () => {
        throw new Error('no such connection')
      },
    })
    expect(
      await resolveAuxiliaryModel({ deps, userId: 'u', slot, catalog: { providers: [] } as never }),
    ).toBeNull()
  })

  test('a provider missing from the catalog → null', async () => {
    const deps = makeDeps({
      requireConnection: async () => ({}),
      ensureFreshKeys: async () => ({ providerId: 'missing', keys: [], label: 'L' }),
    })
    expect(
      await resolveAuxiliaryModel({
        deps,
        userId: 'u',
        slot,
        catalog: { providers: [{ id: 'other' }] } as never,
      }),
    ).toBeNull()
  })

  test('no enabled key for the connection → null', async () => {
    const deps = makeDeps({
      requireConnection: async () => ({}),
      ensureFreshKeys: async () => ({
        providerId: 'p',
        label: 'L',
        keys: [{ enabled: false, priority: 0, apiKey: 'k', authType: 'key' }],
      }),
    })
    expect(
      await resolveAuxiliaryModel({
        deps,
        userId: 'u',
        slot,
        catalog: { providers: [{ id: 'p' }] } as never,
      }),
    ).toBeNull()
  })

  test('rejects a catalog model that cannot produce text', async () => {
    let created = 0
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections: [{ id: 'conn', providerId: 'image' }] }),
        requireConnection: async () => ({ id: 'conn' }),
        ensureFreshKeys: async () => ({
          id: 'conn',
          providerId: 'image',
          keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      catalogService: { getCatalog: async () => catalog },
      languageModelFactory: {
        create: () => {
          created++
          return {}
        },
      },
    } as never
    const catalog = {
      providers: [{ id: 'image' }],
      models: [{ id: 'image/generator', providerId: 'image', outputModalities: ['image'] }],
    } as never
    expect(
      await resolveLanguageModel({ deps, userId: 'u', modelId: 'image/generator', catalog }),
    ).toBeNull()
    expect(created).toBe(0)
  })

  test('rejects an unknown bare id instead of guessing its provider from a connection', async () => {
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections: [{ id: 'conn', providerId: 'p' }] }),
        requireConnection: async () => ({ id: 'conn' }),
        ensureFreshKeys: async () => ({
          id: 'conn',
          providerId: 'p',
          keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      catalogService: { getCatalog: async () => ({ providers: [{ id: 'p' }], models: [] }) },
      languageModelFactory: { create: () => ({ ref: { providerId: 'p', modelId: 'legacy' } }) },
    } as never
    const resolved = await resolveLanguageModel({
      deps,
      userId: 'u',
      modelId: 'legacy',
      preferredConnectionId: 'conn',
    })
    expect(resolved).toBeNull()
  })

  test('resolves colliding model ids against the exact connection provider', async () => {
    const connections = [{ id: 'second-connection', providerId: 'second' }]
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections }),
        requireConnection: async () => connections[0],
        ensureFreshKeys: async () => ({
          ...connections[0],
          keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      catalogService: { getCatalog: async () => catalog },
      languageModelFactory: { create: () => ({ provider: 'second' }) },
    } as never
    const catalog = {
      providers: [{ id: 'first' }, { id: 'second' }],
      models: [
        { id: 'shared', providerId: 'first', outputModalities: ['image'] },
        { id: 'shared', providerId: 'second', outputModalities: ['text'] },
      ],
    } as never

    const resolved = await resolveLanguageModel({
      deps,
      userId: 'u',
      modelId: 'shared',
      preferredConnectionId: 'second-connection',
      catalog,
    })

    expect(resolved?.providerConnectionId).toBe('second-connection')
  })

  test('fails closed when a deleted connection leaves a bare model id ambiguous', async () => {
    const required: string[] = []
    const connections = [
      { id: 'first-live', providerId: 'first' },
      { id: 'second-live', providerId: 'second' },
    ]
    const catalog = {
      providers: [{ id: 'first' }, { id: 'second' }],
      models: [
        { id: 'shared', providerId: 'first', outputModalities: ['text'] },
        { id: 'shared', providerId: 'second', outputModalities: ['text'] },
      ],
    } as never
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections }),
        requireConnection: async (_userId: string, id: string) => {
          required.push(id)
          return connections.find((connection) => connection.id === id)
        },
      },
      catalogService: { getCatalog: async () => catalog },
      languageModelFactory: { create: () => ({}) },
    } as never

    const resolved = await resolveLanguageModel({
      deps,
      userId: 'u',
      modelId: 'shared',
      preferredConnectionId: 'deleted',
      catalog,
    })

    expect(resolved).toBeNull()
    expect(required).toEqual([])
  })
})

describe('resolveLanguageModel — connection ownership', () => {
  test('never sends a namespaced model through a preferred connection owned by another provider', async () => {
    const required: string[] = []
    const connections = [
      { id: 'wrong', providerId: 'anthropic' },
      { id: 'right', providerId: 'openai' },
    ]
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections }),
        requireConnection: async (_userId: string, id: string) => {
          required.push(id)
          return connections.find((connection) => connection.id === id)
        },
        ensureFreshKeys: async (_userId: string, connection: (typeof connections)[number]) => ({
          ...connection,
          label: connection.id,
          keys: [{ id: 'key-1', enabled: true, priority: 0, apiKey: 'key', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({
          get: async () => ({ type: 'api-key', key: 'key' }),
          modify: async () => ({ type: 'api-key', key: 'key' }),
        }),
      },
      catalogService: { getCatalog: async () => catalog },
      languageModelFactory: {
        create: () => ({
          ref: { providerId: 'openai', modelId: 'gpt-x' },
          complete: async () => ({}),
        }),
      },
    } as never
    const catalog = {
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          apiBaseUrl: 'https://example.test/v1',
          modelCount: 1,
          authType: 'api-key',
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          apiBaseUrl: 'https://example.test/v1',
          modelCount: 1,
          authType: 'api-key',
        },
      ],
      models: [{ id: 'openai/gpt-x', providerId: 'openai' }],
    } as never

    const resolved = await resolveLanguageModel({
      deps,
      userId: 'u',
      modelId: 'openai/gpt-x',
      preferredConnectionId: 'wrong',
      catalog,
    })

    expect(resolved?.providerConnectionId).toBe('right')
    expect(required).toEqual(['right'])
  })
})

describe('resolveLanguageModel — the route rule', () => {
  test('a dead stored account moves to the provider’s usable one, past a disabled-key account', async () => {
    const connections = [
      { id: 'disabled', providerId: 'openrouter', keys: [{ id: 'k0', enabled: false }] },
      { id: 'live', providerId: 'openrouter', keys: [{ id: 'k1', enabled: true }] },
    ]
    const required: string[] = []
    const catalog = {
      providers: [{ id: 'openrouter', name: 'OpenRouter' }],
      models: [
        { id: 'deepseek/deepseek-chat', providerId: 'openrouter', outputModalities: ['text'] },
      ],
    } as never
    const deps = {
      providerConnectionsService: {
        listConnections: async () => ({ connections }),
        requireConnection: async (_userId: string, id: string) => {
          required.push(id)
          return connections.find((connection) => connection.id === id)
        },
        ensureFreshKeys: async (_userId: string, connection: (typeof connections)[number]) => ({
          ...connection,
          keys: [{ id: 'k1', enabled: true, priority: 0, apiKey: 'key', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      catalogService: { getCatalog: async () => catalog },
      languageModelFactory: { create: () => ({}) },
    } as never

    const resolved = await resolveLanguageModel({
      deps,
      userId: 'u',
      modelId: 'deepseek/deepseek-chat',
      preferredConnectionId: 'deleted-old',
      catalog,
    })

    expect(resolved?.providerConnectionId).toBe('live')
    expect(required).toEqual(['live'])
  })
})
