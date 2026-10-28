import { describe, expect, test } from 'bun:test'
import { rebindResolvedProvider, resolveRunModel } from './model-selection'
import { routedAgent, sessionFixture } from '../../../../testing/session-fixture'

// These cases exercise the provider-agnostic main-run route: a stored connection
// is a try-first hint, while provider+model remains the durable identity.

type Key = { id: string; enabled: boolean; priority: number; apiKey: string; authType?: string }

function makeArgs(opts: {
  providerId: string
  catalogProviderIds: string[]
  keys: Key[]
  /** The catalog no longer lists the session's model. */
  modelVanished?: boolean
  /** Loading the connection's credential fails. */
  credentialFails?: boolean
}) {
  const connection = { id: 'conn-1', providerId: opts.providerId, label: 'L', keys: opts.keys }
  const state = { usedKeyId: undefined as string | undefined }
  const args = {
    env: {
      deps: {
        providerConnectionsService: {
          listConnections: async () => ({ connections: [connection] }),
          requireConnection: async () => {
            if (opts.credentialFails) throw new Error('vault entry unreadable')
            return connection
          },
          ensureFreshKeys: async () => connection,
          credentialStoreFor: async () => ({}),
        },
        languageModelFactory: { create: () => ({}) },
      },
    },
    userId: 'u1',
    session: {
      agent: routedAgent({
        providerConnectionId: connection.id,
        modelId: `${opts.providerId}/model-x`,
      }),
    },
    agentId: routedAgent().agentId,
    catalog: {
      providers: opts.catalogProviderIds.map((id) => ({ id, name: id })),
      models: opts.modelVanished
        ? [{ id: `${opts.providerId}/model-y`, providerId: opts.providerId }]
        : [{ id: `${opts.providerId}/model-x`, providerId: opts.providerId }],
    },
    state,
  }
  return { args: args as unknown as Parameters<typeof resolveRunModel>[0], state }
}

describe('rebindResolvedProvider', () => {
  test('a session without an agent has no route to rewrite', () => {
    expect(() => rebindResolvedProvider(sessionFixture({ agent: null }), 'replacement')).toThrow(
      /no agent/,
    )
  })
  test('keeps identity for the exact route and replaces only a stale connection id', () => {
    const session = sessionFixture({
      id: 's1',
      agent: routedAgent({
        providerConnectionId: 'connection-deleted',
        modelId: 'openai/gpt-5.6',
      }),
      runtimeStatus: 'running',
    })
    expect(rebindResolvedProvider(session, 'connection-deleted')).toBe(session)
    expect(rebindResolvedProvider(session, 'connection-live')).toEqual({
      ...session,
      agent: routedAgent({
        providerConnectionId: 'connection-live',
        modelId: 'openai/gpt-5.6',
      }),
    })
  })
})

describe('resolveRunModel — guard branches', () => {
  test('fails clearly when no live connection can serve the selected model', () => {
    const { args } = makeArgs({
      providerId: 'ghost',
      catalogProviderIds: ['anthropic'],
      keys: [{ id: 'k', enabled: true, priority: 0, apiKey: 'x' }],
    })
    expect(resolveRunModel(args)).rejects.toMatchObject({ code: 'NO_PROVIDER_CONNECTION' })
  })

  // Three failures used to share "No usable provider connection"; each has its own fix.
  const failure = (args: Parameters<typeof resolveRunModel>[0]) =>
    resolveRunModel(args).then(
      () => undefined,
      (error: unknown) => error as { code: string; reason?: string; message: string },
    )

  test('no enabled key names the provider and the fix', async () => {
    const { args } = makeArgs({
      providerId: 'anthropic',
      catalogProviderIds: ['anthropic'],
      keys: [
        { id: 'k1', enabled: false, priority: 0, apiKey: 'x' },
        { id: 'k2', enabled: false, priority: 1, apiKey: 'y' },
      ],
    })
    expect(await failure(args)).toMatchObject({
      code: 'NO_PROVIDER_CONNECTION',
      reason: 'no_enabled_key',
      message: 'No enabled key for anthropic. Connect anthropic or enable one of its keys.',
    })
  })

  test('a model the catalog no longer lists says it is gone', async () => {
    const { args } = makeArgs({
      providerId: 'anthropic',
      catalogProviderIds: ['anthropic'],
      keys: [{ id: 'k', enabled: true, priority: 0, apiKey: 'x' }],
      modelVanished: true,
    })
    // A namespaced id with a live connection still resolves (live models are allowed), so the
    // vanished case that reaches here is the bare id the resolver cannot place.
    ;(args.session.agent as { modelId: string }).modelId = 'model-x'
    expect(await failure(args)).toMatchObject({
      reason: 'model_not_in_catalog',
      message: 'Model "model-x" is no longer available. Choose another model.',
    })
  })

  test('a credential that will not load asks for a new sign-in', async () => {
    const { args } = makeArgs({
      providerId: 'anthropic',
      catalogProviderIds: ['anthropic'],
      keys: [{ id: 'k', enabled: true, priority: 0, apiKey: 'x' }],
      credentialFails: true,
    })
    expect(await failure(args)).toMatchObject({
      reason: 'credential_unavailable',
      message: 'Could not load the credential for anthropic. Sign in again or re-add its key.',
    })
  })

  test('selects the lowest-priority enabled key before building the provider', async () => {
    // The shared resolver and the main agent run must pick the same key.
    const { args, state } = makeArgs({
      providerId: 'anthropic',
      catalogProviderIds: ['anthropic'],
      keys: [
        { id: 'k1', enabled: false, priority: -1, apiKey: 'a' },
        { id: 'k2', enabled: true, priority: 0, apiKey: 'b' },
        { id: 'k3', enabled: true, priority: 5, apiKey: 'c' },
      ],
    })
    await resolveRunModel(args)
    expect(state.usedKeyId).toBe('k2')
  })

  test('builds the runtime model from the session connection/model selection', async () => {
    const refs: unknown[] = []
    const connection = {
      id: 'connection-new',
      providerId: 'openai',
      label: 'OpenAI',
      keys: [
        {
          id: 'key-1',
          enabled: true,
          priority: 0,
          apiKey: 'secret',
          authType: 'api-key',
        },
      ],
    }
    const model = {
      ref: { providerId: 'openai', modelId: 'gpt-5.4' },
      complete(): never {
        throw new Error('not exercised by model selection')
      },
    }
    const args = {
      env: {
        deps: {
          providerConnectionsService: {
            listConnections: async () => ({ connections: [connection] }),
            requireConnection: async () => connection,
            ensureFreshKeys: async () => connection,
            credentialStoreFor: async () => ({ get: async () => null }),
          },
          languageModelFactory: {
            create: (ref: unknown) => {
              refs.push(ref)
              return model
            },
          },
        },
      },
      userId: 'u1',
      session: {
        agent: routedAgent({
          providerConnectionId: 'connection-new',
          modelId: 'openai/gpt-5.4',
        }),
      },
      agentId: routedAgent().agentId,
      catalog: {
        providers: [{ id: 'openai' }],
        models: [{ id: 'openai/gpt-5.4', providerId: 'openai' }],
      },
      state: { usedKeyId: undefined },
    }

    const resolved = await resolveRunModel(args as unknown as Parameters<typeof resolveRunModel>[0])

    expect(refs).toEqual([{ providerId: 'openai', modelId: 'gpt-5.4' }])
    expect(resolved.model).toBe(model)
    expect(resolved.connection.id).toBe('connection-new')
    expect(resolved.effectiveModelId).toBe('openai/gpt-5.4')
  })

  test('recovers when the saved session connection was deleted and re-added', async () => {
    const live = {
      id: 'connection-readded',
      providerId: 'openai',
      keys: [
        {
          id: 'key-live',
          enabled: true,
          priority: 0,
          apiKey: 'secret',
          authType: 'api-key',
        },
      ],
    }
    const required: string[] = []
    const resolved = await resolveRunModel({
      env: {
        deps: {
          providerConnectionsService: {
            listConnections: async () => ({ connections: [live] }),
            requireConnection: async (_userId: string, id: string) => {
              required.push(id)
              return live
            },
            ensureFreshKeys: async () => live,
            credentialStoreFor: async () => ({}),
          },
          languageModelFactory: { create: () => ({}) },
        },
      } as never,
      userId: 'u1',
      session: {
        agent: routedAgent({
          providerConnectionId: 'connection-deleted',
          modelId: 'openai/gpt-5.6',
        }),
      } as never,
      agentId: routedAgent().agentId,
      catalog: {
        providers: [{ id: 'openai' }],
        models: [{ id: 'openai/gpt-5.6', providerId: 'openai' }],
      } as never,
      state: { usedKeyId: undefined } as never,
    })

    expect(required).toEqual(['connection-readded'])
    expect(resolved.connection.id).toBe('connection-readded')
  })
})
