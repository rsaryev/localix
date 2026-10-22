import { afterEach, describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { setAgentService, type AgentServiceBinding } from '../agent-service-binding'
import { createAgentHookRunner, createPromptHookEvaluator } from './cc-hook-evaluators'
import { routedParticipants, sessionFixture } from '../../../../testing/session-fixture'
import type { RunProfile } from '../../../agent-core/run-shape'

const session: SessionRecord = sessionFixture({
  id: 'parent',
  userId: 'u',
  title: 'parent',
  agents: routedParticipants({
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
    await createAgentHookRunner({ userId: 'u', session })({
      prompt: 'verify',
      inputJson: '{}',
      timeoutMs: 1000,
      signal: controller.signal,
    })
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

    await createAgentHookRunner({ userId: 'u', session })({
      prompt: 'verify',
      inputJson: '{}',
      timeoutMs: 1000,
    })

    expect(creates[0]).toEqual(
      expect.objectContaining({
        provenance: { kind: 'hook', parentSessionId: 'parent', phase: 'verifier' },
      }),
    )
  })

  test('puts the hook input where the prompt names $ARGUMENTS', async () => {
    const tasks: string[] = []
    setAgentService({
      createSession: async () => ({ id: 'hook-child' }),
      runJobTask: async (_u: string, _s: string, text: string) => {
        tasks.push(text)
      },
      finalAssistantText: async () => '{"ok":true}',
    } as unknown as AgentServiceBinding)
    const run = createAgentHookRunner({ userId: 'u', session })
    await run({ prompt: 'Judge $ARGUMENTS for \\$1.00', inputJson: '{"a":1}', timeoutMs: 1000 })
    await run({ prompt: 'Judge it', inputJson: '{"a":1}', timeoutMs: 1000 })
    expect(tasks).toEqual(['Judge {"a":1} for $1.00', 'Judge it\n\n{"a":1}'])
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

    await createAgentHookRunner({ userId: 'u', session })({
      prompt: 'verify',
      inputJson: '{}',
      timeoutMs: 1000,
    })

    // The profile is the verifier's whole identity: nothing else may widen its tools.
    const profile = runs[0]?.profileOverride as RunProfile
    expect(profile.declaredTools).toEqual(['read', 'search'])
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
 * spend reaches the ledger under its own kind, and that the module's fail-open invariant
 * survives a ledger that is broken.
 */
describe('prompt hook billing', () => {
  const modelDeps = (complete: () => Promise<unknown>) => ({
    providerConnectionsService: {
      listConnections: async () => ({ connections: [{ id: 'connection', providerId: 'p' }] }),
      requireConnection: async () => ({ id: 'connection' }),
      ensureFreshKeys: async () => ({
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
    createPromptHookEvaluator({
      env,
      userId: 'u',
      session,
      catalog: catalog as never,
      effectiveModelId: 'p/m',
    })({ prompt: 'allow?', inputJson: '{}', timeoutMs: 1000 })

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

    expect(verdict).toEqual({ ok: true })
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
    // The module's whole invariant is FAIL OPEN. Billing is bookkeeping bolted onto that,
    // so a rejecting ledger must change nothing the caller sees.
    const verdict = await evaluate(
      envWith(
        async () => ({ content: '{"ok":false,"reason":"nope"}', usage: { inputTokens: 1 } }),
        async () => {
          throw new Error('ledger down')
        },
      ),
    )

    expect(verdict).toEqual({ ok: false, reason: 'nope' })
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
