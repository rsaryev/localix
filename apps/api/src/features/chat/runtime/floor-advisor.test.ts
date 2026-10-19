import { describe, expect, test } from 'bun:test'
import type { DecisionRequest } from '@localixai/agent/runtime'
import { createFloorAdvisor, type FloorDecisionRecord, type FloorStrategy } from './floor-advisor'
import type { FloorQuestion } from './floor-advice'
import { decisionFloorStrategy, FLOOR_DECISION_MODEL } from './floor-decision'
import { similarityFloorStrategy } from './floor-similarity'

const question: FloorQuestion = {
  members: [
    { agentId: 'builtin:localix', handle: 'localix' },
    { agentId: 'builtin:lawyer', handle: 'lawyer' },
  ],
  history: [],
  text: 'Can we reuse photos from other shops for the product cards?',
  leaderAgentId: 'builtin:localix',
}
const scope = { userId: 'u1', sessionId: 's1', projectId: null }

/** The decision strategy over a fake OpenRouter connection (or none) and a scripted model. */
function decision(options: {
  connections?: { id: string; providerId: string }[]
  decide?: (request: DecisionRequest) => Promise<unknown>
}) {
  const asked: DecisionRequest[] = []
  const ledger: unknown[] = []
  const connections = options.connections ?? [{ id: 'or-connection', providerId: 'openrouter' }]
  const catalog = {
    providers: [{ id: 'openrouter' }],
    models: [
      {
        id: FLOOR_DECISION_MODEL,
        providerId: 'openrouter',
        kind: 'decision',
        outputModalities: ['decisions'],
      },
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
  const strategy = decisionFloorStrategy({
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
        create: (ref: unknown) => ({
          ref,
          decide: (request: DecisionRequest) => {
            asked.push(request)
            return decide(request)
          },
        }),
      },
    } as never,
    usageRepo: { accumulateEvent: async (event: unknown) => void ledger.push(event) } as never,
  })
  return { strategy, asked, ledger }
}

/** A strategy that always answers `pick`, or is unavailable. */
const fixed = (pick: string | null, available = true): FloorStrategy => ({
  prepare: async () =>
    available
      ? {
          strategy: 'similarity',
          model: 'fixed',
          advise: async () => ({ pick, reason: pick ? 'similar' : 'unsure', next: {} }),
        }
      : null,
})

function advisor(strategies: FloorStrategy[], deadlineMs?: number) {
  const records: FloorDecisionRecord[] = []
  const advise = createFloorAdvisor({
    strategies,
    listRegistryAgents: async () => [
      {
        agentId: 'builtin:lawyer',
        name: 'lawyer',
        description: 'Contracts and consent.',
        enabled: true,
        canJoinConversation: true,
      },
    ],
    ...(deadlineMs ? { deadlineMs } : {}),
    log: (record) => records.push(record),
  })(scope)
  return { advise, records }
}

describe('the chain of group-routing strategies', () => {
  test('with OpenRouter connected, Jev answers, and its spend lands in the ledger', async () => {
    const jev = decision({})
    const { advise, records } = advisor([jev.strategy, fixed('localix')])
    expect(await advise(question)).toBe('lawyer')
    // Options are described from the agent directory, like the prompt describes them.
    expect((jev.asked[0]!.questions.next!.criteria as Record<string, string>).lawyer).toBe(
      'Contracts and consent.',
    )
    await Bun.sleep(0)
    expect(jev.ledger).toEqual([
      expect.objectContaining({ finishReason: 'routing', modelId: FLOOR_DECISION_MODEL }),
    ])
    expect(records).toEqual([
      expect.objectContaining({ strategy: 'decision', pick: 'lawyer', reason: 'confident' }),
    ])
  })

  test('without a connection serving Jev, the next strategy answers', async () => {
    const jev = decision({ connections: [] })
    const { advise, records } = advisor([jev.strategy, fixed('lawyer')])
    expect(await advise(question)).toBe('lawyer')
    expect(jev.asked).toEqual([])
    expect(records[0]).toMatchObject({ strategy: 'similarity', model: 'fixed' })
  })

  test('with nothing available, the grammar decides and the log says why', async () => {
    const { advise, records } = advisor([decision({ connections: [] }).strategy, fixed('x', false)])
    expect(await advise(question)).toBeNull()
    expect(records).toEqual([expect.objectContaining({ strategy: null, reason: 'none' })])
  })

  test('a strategy that fails leaves the turn to the grammar, not to the next strategy', async () => {
    const jev = decision({
      decide: async () => {
        throw new Error('503')
      },
    })
    const { advise, records } = advisor([jev.strategy, fixed('lawyer')])
    expect(await advise(question)).toBeNull()
    expect(records).toEqual([expect.objectContaining({ strategy: 'decision', reason: 'error' })])
  })

  test('an unconfident answer is no advice', async () => {
    const jev = decision({
      decide: async () => ({
        answers: { next: { type: 'choice', choice: 'lawyer', probabilities: { lawyer: 0.55 } } },
      }),
    })
    expect(await advisor([jev.strategy]).advise(question)).toBeNull()
  })

  test('a slow answer is cut at the deadline: the next turn does not wait on it', async () => {
    const jev = decision({ decide: () => new Promise((resolve) => setTimeout(resolve, 5_000)) })
    const { advise, records } = advisor([jev.strategy], 50)
    const started = Date.now()
    expect(await advise(question)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(records).toEqual([expect.objectContaining({ reason: 'deadline' })])
  })

  test('the log names who answered and why, without message text', async () => {
    const { advise, records } = advisor([decision({}).strategy])
    await advise(question)
    expect(JSON.stringify(records)).not.toContain('photos')
  })
})

describe('the similarity strategy', () => {
  // A toy embedder: each text's vector says which of a few topics it mentions.
  const TOPICS = ['photos', 'contract', 'hello', 'tiles']
  const embed = async (text: string) =>
    Float32Array.from(TOPICS.map((t) => (text.toLowerCase().includes(t) ? 1 : 0.01)))
  const members = [
    { agentId: 'builtin:localix', handle: 'localix', description: 'Says hello and coordinates.' },
    { agentId: 'builtin:lawyer', handle: 'lawyer', description: 'Contracts, photos and licences.' },
  ]
  const strategy = similarityFloorStrategy({ embedder: () => embed, model: 'gemma' })

  test('unavailable while the embedding model cannot run', async () => {
    const none = similarityFloorStrategy({ embedder: () => null, model: 'gemma' })
    expect(await none.prepare(scope)).toBeNull()
  })

  test('the person’s untagged message goes to the participant it is clearly nearest to', async () => {
    const runner = (await strategy.prepare(scope))!
    const reading = await runner.advise(
      { ...question, members, text: 'May we reuse these photos?' },
      new AbortController().signal,
    )
    expect(reading).toMatchObject({ pick: 'lawyer', reason: 'similar' })
  })

  test('a reply is never advised on: similarity cannot tell a report from a handoff', async () => {
    const runner = (await strategy.prepare(scope))!
    const reading = await runner.advise(
      { ...question, members, authorAgentId: 'builtin:lawyer', text: 'The photos are fine.' },
      new AbortController().signal,
    )
    expect(reading.pick).toBeNull()
  })
})
