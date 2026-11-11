import { afterEach, describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { setAgentService, type AgentServiceBinding } from '../agent-service-binding'
import { createHookModels, type HookModelsInput } from './cc-hook-evaluators'
import { routedAgent, sessionFixture } from '../../../../testing/session-fixture'
import type { RunProfile } from '../../../agent-core/run-shape'

// A `model:` value is read as the app reads it, through the kit (`bootstrap/domain-services.ts`).

const session: SessionRecord = sessionFixture({
  id: 'parent',
  userId: 'u',
  title: 'parent',
  agent: routedAgent({
    providerConnectionId: 'connection',
    modelId: 'model',
    reasoningEffort: 'low',
  }),
  createdAt: 'now',
  updatedAt: 'now',
  lastMessageAt: 'now',
  rootSessionId: 'parent',
})

afterEach(() => setAgentService(null as unknown as AgentServiceBinding))

const live = () => new AbortController().signal
const agentRequest = (over: { model?: string; signal?: AbortSignal } = {}) => ({
  prompt: 'verify',
  tools: [],
  readOnly: true as const,
  maxTurns: 50,
  signal: live(),
  ...over,
})
/** The run's models over an env with no provider: enough for the verifier. */
const verifier = () =>
  createHookModels({
    env: {} as never,
    userId: 'u',
    session,
    catalog: {} as never,
    offeredModelIds: [],
    effectiveModelId: 'p/m',
  })

describe('agent hook verifier', () => {
  test('cancellation during child creation stops the child without starting its run', async () => {
    const controller = new AbortController()
    const stopped: string[] = []
    let runs = 0
    setAgentService({
      createSession: async () => {
        controller.abort()
        return { id: 'late-child' }
      },
      stopSession: (id: string) => {
        stopped.push(id)
      },
      runJobTask: async () => {
        runs++
      },
    } as unknown as AgentServiceBinding)
    await expect(verifier().runAgent(agentRequest({ signal: controller.signal }))).rejects.toThrow(
      'cancelled',
    )
    expect(stopped).toEqual(['late-child'])
    expect(runs).toBe(0)
  })

  test('persists typed hook provenance on its child', async () => {
    const creates: unknown[] = []
    setAgentService({
      createSession: async (
        _userId: Parameters<AgentServiceBinding['createSession']>[0],
        input: Parameters<AgentServiceBinding['createSession']>[1],
      ) => {
        creates.push(input)
        return { id: 'hook-child' }
      },
      runJobTask: async () => undefined,
      finalAssistantText: async () => '{"ok":true}',
    } as unknown as AgentServiceBinding)

    await verifier().runAgent(agentRequest())

    expect(creates[0]).toEqual(
      expect.objectContaining({
        provenance: { kind: 'hook', parentSessionId: 'parent', phase: 'verifier' },
      }),
    )
  })

  test('runs its child on a read-only profile it resolved itself', async () => {
    const runs: Record<string, unknown>[] = []
    setAgentService({
      createSession: async () => ({ id: 'hook-child' }),
      runJobTask: async (_u: string, _s: string, _t: string, opts: Record<string, unknown>) => {
        runs.push(opts)
      },
      finalAssistantText: async () => '{"ok":true}',
    } as unknown as AgentServiceBinding)

    await verifier().runAgent(agentRequest())

    // The profile is the verifier's whole identity: nothing else may widen its tools.
    const profile = runs[0]?.profileOverride as RunProfile
    expect(profile.declaredTools).toEqual(['Read', 'Search'])
    expect(profile.prompt.identity).toContain('hook policy verifier')
    expect(Object.keys(runs[0]!).sort()).toEqual([
      'invocation',
      'maxTurns',
      'profileOverride',
      'wait',
    ])
  })
})

/**
 * `prompt` hooks spend real tokens on the user's key, once per hook EVENT — a PreToolUse
 * hook fires per tool call, so it can outspend the turn it guards. These tests pin that the
 * spend reaches the ledger under its own kind, and that a broken ledger changes no answer.
 */
describe('prompt hook billing', () => {
  const modelDeps = (complete: () => Promise<unknown>) => ({
    providerConnectionsService: {
      listConnections: async () => ({ connections: [{ id: 'connection', providerId: 'p' }] }),
      requireConnection: async () => ({
        id: 'connection',
        providerId: 'p',
        keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
      }),
      credentialStoreFor: async () => ({}),
    },
    catalogService: { getCatalog: async () => catalog },
    languageModelFactory: { create: () => ({ ref: { providerId: 'p', modelId: 'm' }, complete }) },
    streamRegistry: { publish: () => {} },
  })

  const catalog = {
    providers: [{ id: 'p' }],
    models: [{ id: 'p/m', providerId: 'p', outputModalities: ['text'] }],
  }

  const envWith = (
    complete: () => Promise<unknown>,
    accumulateEvent: (event: Record<string, unknown>) => Promise<void>,
  ) =>
    ({
      deps: modelDeps(complete),
      repo: { getActiveBranchUsage: async () => [] },
      // `queryStats` too: recording publishes a fresh session snapshot, and a fake missing
      // it would exercise only the degraded path.
      usageRepo: { accumulateEvent, queryStats: async () => [] },
    }) as never

  const evaluate = (env: ReturnType<typeof envWith>) =>
    createHookModels({
      env,
      userId: 'u',
      session,
      catalog: catalog as never,
      offeredModelIds: ['p/m'],
      effectiveModelId: 'p/m',
    }).complete({ prompt: 'allow?', signal: live() })

  test('the verdict call lands in the ledger under the hook kind', async () => {
    const events: Array<Record<string, unknown>> = []
    const verdict = await evaluate(
      envWith(
        async () => ({ content: '{"ok":true}', usage: { inputTokens: 40, outputTokens: 6 } }),
        async (event) => {
          events.push(event)
        },
      ),
    )

    expect(verdict).toBe('{"ok":true}')
    // `finishReason` is the bucket the dashboard's Kind breakdown groups on, so the kind
    // has to be this exact string — a plausible-looking alternative would silently fold
    // hook spend into the 'turn' bucket.
    expect(events[0]).toEqual(
      expect.objectContaining({
        finishReason: 'hook',
        sessionId: 'parent',
        modelId: 'p/m',
        providerConnectionId: 'connection',
      }),
    )
  })

  test('a broken ledger cannot turn a hook into a turn failure', async () => {
    // Billing is bookkeeping: a rejecting ledger must change nothing the hook reads.
    const verdict = await evaluate(
      envWith(
        async () => ({ content: '{"ok":false,"reason":"nope"}', usage: { inputTokens: 1 } }),
        () => Promise.reject(new Error('ledger down')),
      ),
    )
    expect(verdict).toBe('{"ok":false,"reason":"nope"}')
  })

  test('a call the provider reported no tokens for writes no row', async () => {
    const events: Array<Record<string, unknown>> = []
    await evaluate(
      envWith(
        async () => ({ content: '{"ok":true}' }),
        async (event) => {
          events.push(event)
        },
      ),
    )

    expect(events).toEqual([])
  })
})

describe('the model a hook names', () => {
  const catalog = {
    providers: [{ id: 'p' }],
    models: [
      { id: 'p/m', providerId: 'p', outputModalities: ['text'] },
      { id: 'p/claude-haiku-4-5', providerId: 'p', outputModalities: ['text'] },
    ],
  }
  const deps = (created: unknown[]) => ({
    providerConnectionsService: {
      listConnections: async () => ({ connections: [{ id: 'connection', providerId: 'p' }] }),
      requireConnection: async () => ({
        id: 'connection',
        providerId: 'p',
        keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'k', authType: 'api-key' }],
      }),
      credentialStoreFor: async () => ({}),
    },
    catalogService: { getCatalog: async () => catalog },
    languageModelFactory: {
      create: (input: unknown) => {
        created.push(input)
        return {
          ref: { providerId: 'p', modelId: 'm' },
          complete: async () => ({ content: '{"ok":true}' }),
        }
      },
    },
    streamRegistry: { publish: () => {} },
  })
  const models = (created: unknown[], over: Partial<HookModelsInput> = {}) =>
    createHookModels({
      env: { deps: deps(created), repo: {}, usageRepo: {} } as never,
      userId: 'u',
      session,
      catalog: catalog as never,
      offeredModelIds: catalog.models.map((model) => model.id),
      effectiveModelId: 'p/m',
      ...over,
    })

  test('an alias (haiku) becomes the catalog model of that family', async () => {
    const created: unknown[] = []
    expect(
      await models(created).complete({ prompt: 'allow?', model: 'haiku', signal: live() }),
    ).toBe('{"ok":true}')
    expect(JSON.stringify(created)).toContain('claude-haiku-4-5')
  })

  // The catalog lists every provider's models; one no live key runs is not offered, so a hook's
  // alias stays on the run's model rather than failing on a provider the person never connected.
  test('an alias whose family no live key runs stays on the run model', async () => {
    const created: unknown[] = []
    await models(created, { offeredModelIds: ['p/m'] }).complete({
      prompt: 'allow?',
      model: 'haiku',
      signal: live(),
    })
    expect(JSON.stringify(created)).not.toContain('claude-haiku-4-5')
  })

  // A throw is the kit's model failure: what it means for the hook is the kit's.
  test('a model that cannot be resolved throws, never a verdict', async () => {
    await expect(
      models([]).complete({ prompt: 'allow?', model: 'nonexistent/model', signal: live() }),
    ).rejects.toThrow('not available')
  })

  test('a session with no provider route throws', async () => {
    const unrouted = { ...session, agent: null } as unknown as SessionRecord
    await expect(
      models([], { session: unrouted }).complete({ prompt: 'allow?', signal: live() }),
    ).rejects.toThrow('no provider connection')
  })

  test('a verifier session opens on the catalog model of an alias', async () => {
    const creates: Array<{ modelId?: string }> = []
    setAgentService({
      createSession: async (_u: string, input: { modelId?: string }) => {
        creates.push(input)
        return { id: 'hook-child' }
      },
      runJobTask: async () => undefined,
      finalAssistantText: async () => '{"ok":true}',
    } as unknown as AgentServiceBinding)
    await models([]).runAgent(agentRequest({ model: 'haiku' }))
    expect(creates[0]?.modelId).toBe('p/claude-haiku-4-5')
  })

  test('a verifier that cannot start throws', async () => {
    setAgentService({
      createSession: async () => {
        throw new Error('no capacity')
      },
    } as unknown as AgentServiceBinding)
    await expect(verifier().runAgent(agentRequest())).rejects.toThrow('no capacity')
  })
})
