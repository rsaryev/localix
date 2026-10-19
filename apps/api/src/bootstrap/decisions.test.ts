import { describe, expect, test } from 'bun:test'
import type { DecisionRequest } from '@localixai/agent/runtime'
import { DECISION_MODELS } from '../features/decisions/models'
import { buildDecisionService } from './decisions'

const [DEFAULT_DECISION_MODEL] = DECISION_MODELS

/** The composed service over a fake OpenRouter connection (or none) and a scripted model. */
function composed(connections = [{ id: 'or-connection', providerId: 'openrouter' }]) {
  const asked: DecisionRequest[] = []
  const ledger: unknown[] = []
  const catalog = {
    providers: [{ id: 'openrouter' }],
    models: [
      // The same id as a chat model: only the decision entry may answer.
      { id: DEFAULT_DECISION_MODEL, providerId: 'openrouter', kind: 'chat' },
      {
        id: DEFAULT_DECISION_MODEL,
        providerId: 'openrouter',
        kind: 'decision',
        outputModalities: ['decisions'],
      },
    ],
  }
  const decisions = buildDecisionService({
    db: {} as never,
    logger: { info: () => {} } as never,
    usageRepo: { accumulateEvent: async (event: unknown) => void ledger.push(event) },
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
        decide: async (request: DecisionRequest) => {
          asked.push(request)
          return {
            answers: { next: { type: 'choice', choice: 'a', probabilities: { a: 0.9 } } },
            usage: { input: 400, output: 30, totalTokens: 430, cost: { total: 0.00002 } },
          }
        },
      }),
    },
  } as never)
  return { decisions, asked, ledger }
}

describe('decisions over the user’s connections', () => {
  test('a live OpenRouter connection serves the decision model', async () => {
    const { decisions, asked, ledger } = composed()
    expect(await decisions.available('u1')).toEqual({ model: DEFAULT_DECISION_MODEL })
    const outcome = await decisions.decide(
      'u1',
      {
        state: {},
        questions: { next: { type: 'choice', instructions: '?', criteria: { a: 'A' } } },
      },
      { purpose: 'test', sessionId: 's1' },
    )
    expect(outcome.status).toBe('answered')
    expect(asked).toHaveLength(1)
    await Bun.sleep(0)
    expect(ledger).toEqual([
      expect.objectContaining({
        finishReason: 'decision',
        modelId: DEFAULT_DECISION_MODEL,
        providerConnectionId: 'or-connection',
        providerId: 'openrouter',
      }),
    ])
  })

  test('no connection serving it: unavailable', async () => {
    const { decisions } = composed([])
    expect(await decisions.available('u1')).toBeNull()
  })
})
