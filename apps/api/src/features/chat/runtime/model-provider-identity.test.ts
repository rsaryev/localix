import { describe, expect, test } from 'bun:test'
import { resolveLanguageModel } from './model-resolution'

function harness(refreshProvider?: string) {
  const required: string[] = []
  const built: unknown[] = []
  const connections = [
    { id: 'a-connection', providerId: 'a' },
    { id: 'b-connection', providerId: 'b' },
  ]
  const catalog = {
    providers: [{ id: 'a' }, { id: 'b' }],
    models: [
      { id: 'shared-model', providerId: 'a' },
      { id: 'shared-model', providerId: 'b' },
      { id: 'a/only-a', providerId: 'a' },
    ],
  }
  const deps = {
    catalogService: { getCatalog: async () => catalog },
    providerConnectionsService: {
      listConnections: async () => ({ connections }),
      requireConnection: async (_owner: string, id: string) => {
        required.push(id)
        return connections.find((connection) => connection.id === id)!
      },
      ensureFreshKeys: async (_owner: string, connection: (typeof connections)[number]) => ({
        ...connection,
        providerId: refreshProvider ?? connection.providerId,
        keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'test', authType: 'api-key' }],
      }),
      credentialStoreFor: async () => ({}),
    },
    languageModelFactory: {
      create: (ref: unknown) => {
        built.push(ref)
        return { ref }
      },
    },
  }
  return { deps: deps as never, required, built }
}

describe('explicit native provider identity', () => {
  test('disambiguates a model without borrowing the preferred connection provider', async () => {
    const h = harness()
    const result = await resolveLanguageModel({
      deps: h.deps,
      userId: 'owner',
      modelId: 'shared-model',
      providerId: 'b',
      preferredConnectionId: 'a-connection',
    })
    expect(result?.providerConnectionId).toBe('b-connection')
    expect(h.required).toEqual(['b-connection'])
    expect(h.built).toEqual([{ providerId: 'b', modelId: 'shared-model' }])
  })

  test.each(['missing', 'b'])(
    'rejects an incompatible provider %s before accessing credentials',
    async (providerId) => {
      const h = harness()
      expect(
        await resolveLanguageModel({
          deps: h.deps,
          userId: 'owner',
          modelId: 'a/only-a',
          providerId,
          preferredConnectionId: 'a-connection',
        }),
      ).toBeNull()
      expect(h.required).toEqual([])
      expect(h.built).toEqual([])
    },
  )

  test('cannot switch provider identity while refreshing the selected connection', async () => {
    const h = harness('a')
    expect(
      await resolveLanguageModel({
        deps: h.deps,
        userId: 'owner',
        modelId: 'shared-model',
        providerId: 'b',
      }),
    ).toBeNull()
    expect(h.required).toEqual(['b-connection'])
    expect(h.built).toEqual([])
  })
})
