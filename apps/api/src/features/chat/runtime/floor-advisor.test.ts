import { describe, expect, test } from 'bun:test'
import type { DecisionRequest } from '@localixai/agent/runtime'
import { createFloorAdvisor, type FloorDecisionRecord } from './floor-advisor'
import type { FloorQuestion } from './floor-advice'

const JEV = 'openrouter/~typesafe/jev-latest'

function harness(options: {
  settings?: unknown
  connections?: { id: string; providerId: string }[]
  decide?: (request: DecisionRequest) => Promise<unknown>
  deadlineMs?: number
}) {
  const built: unknown[] = []
  const asked: DecisionRequest[] = []
  const ledger: unknown[] = []
  const records: FloorDecisionRecord[] = []
  const connections = options.connections ?? [{ id: 'or-connection', providerId: 'openrouter' }]
  const catalog = {
    providers: [{ id: 'openrouter' }],
    models: [
      { id: JEV, providerId: 'openrouter', kind: 'decision', outputModalities: ['decisions'] },
    ],
  }
  const decide =
    options.decide ??
    (async () => ({
      answers: {
        next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.93, localix: 0.07 } },
      },
      usage: { inputTokens: 400, outputTokens: 30, totalCost: 0.00002 },
    }))
  const advisor = createFloorAdvisor({
    runner: {
      catalogService: { getFullCatalog: async () => catalog, getCatalog: async () => catalog },
      providerConnectionsService: {
        listConnections: async () => ({ connections }),
        requireConnection: async (_owner: string, id: string) =>
          connections.find((connection) => connection.id === id)!,
        ensureFreshKeys: async (_owner: string, connection: (typeof connections)[number]) => ({
          ...connection,
          keys: [{ id: 'key', enabled: true, priority: 0, apiKey: 'sk', authType: 'api-key' }],
        }),
        credentialStoreFor: async () => ({}),
      },
      languageModelFactory: {
        create: (ref: unknown) => {
          built.push(ref)
          return {
            ref,
            decide: (request: DecisionRequest) => {
              asked.push(request)
              return decide(request)
            },
          }
        },
      },
      listRegistryAgents: async () => [
        { agentId: 'builtin:lawyer', name: 'lawyer', description: 'Contracts and consent.' },
      ],
    } as never,
    userProfileRepo: {
      getRaw: async () =>
        options.settings === undefined
          ? null
          : { agent_settings: JSON.stringify(options.settings) },
    } as never,
    usageRepo: { accumulateEvent: async (event: unknown) => void ledger.push(event) } as never,
    ...(options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
    log: (record) => records.push(record),
  })({ userId: 'u1', sessionId: 's1', projectId: null })
  return { advisor, built, asked, ledger, records }
}

const question: FloorQuestion = {
  members: [
    { agentId: 'builtin:localix', handle: 'localix' },
    { agentId: 'builtin:lawyer', handle: 'lawyer' },
  ],
  history: [],
  text: 'Can we reuse photos from other shops for the product cards?',
}

describe('the group-routing advisor', () => {
  test('with no choice made, runs the default decision model through the provider’s connection', async () => {
    const h = harness({})
    expect(await h.advisor(question)).toBe('lawyer')
    expect(h.built).toEqual([{ providerId: 'openrouter', modelId: '~typesafe/jev-latest' }])
    // Options are described from the agent directory, like the prompt describes them.
    expect((h.asked[0]!.questions.next!.criteria as Record<string, string>).lawyer).toBe(
      'Contracts and consent.',
    )
  })

  test('the spend lands in the ledger as group routing', async () => {
    const h = harness({})
    await h.advisor(question)
    await Bun.sleep(0)
    expect(h.ledger).toEqual([
      expect.objectContaining({ finishReason: 'routing', modelId: JEV, sessionId: 's1' }),
    ])
  })

  test('switched off in the model picker, it asks nothing', async () => {
    const h = harness({ settings: { modelRouting: { groupRouting: { enabled: false } } } })
    expect(await h.advisor(question)).toBeNull()
    expect(h.built).toEqual([])
  })

  test('the model chosen for the route is the one asked', async () => {
    const h = harness({
      settings: {
        modelRouting: {
          groupRouting: { providerConnectionId: 'or-connection', modelId: 'openrouter/liquid/d1' },
        },
      },
    })
    await h.advisor(question)
    expect(h.built).toEqual([{ providerId: 'openrouter', modelId: 'liquid/d1' }])
  })

  test('without a connection serving the model it is off, and the grammar decides', async () => {
    const h = harness({ connections: [] })
    expect(await h.advisor(question)).toBeNull()
    expect(h.asked).toEqual([])
  })

  test('a failed or unconfident decision is no advice', async () => {
    expect(
      await harness({
        decide: async () => {
          throw new Error('503')
        },
      }).advisor(question),
    ).toBeNull()
    expect(
      await harness({
        decide: async () => ({
          answers: { next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.55 } } },
        }),
      }).advisor(question),
    ).toBeNull()
  })

  test('a slow decision is cut at the deadline: the next turn does not wait on it', async () => {
    const h = harness({
      deadlineMs: 50,
      decide: () => new Promise((resolve) => setTimeout(resolve, 5_000)),
    })
    const started = Date.now()
    expect(await h.advisor(question)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  test('each decision is logged: what was followed, why, and the probabilities — no text', async () => {
    const h = harness({})
    await h.advisor(question)
    expect(h.records).toEqual([
      expect.objectContaining({
        sessionId: 's1',
        on: 'message',
        model: JEV,
        pick: 'lawyer',
        reason: 'confident',
        next: { lawyer: 0.93, localix: 0.07 },
      }),
    ])
    expect(JSON.stringify(h.records)).not.toContain('photos')
  })

  test('a failed decision is logged with its cause', async () => {
    const h = harness({
      decide: async () => {
        throw new Error('503')
      },
    })
    await h.advisor(question)
    expect(h.records).toEqual([expect.objectContaining({ pick: null, reason: 'provider_error' })])
  })

  test('the person’s untagged message carries the two coordination questions', async () => {
    const h = harness({})
    await h.advisor({ ...question, leaderAgentId: 'builtin:localix' })
    expect(Object.keys(h.asked[0]!.questions)).toEqual(['next', 'alone', 'which'])
  })
})
