import { describe, expect, test } from 'bun:test'
import type { MiniAppContext } from './context'
import type { DecisionHost, DecisionOutcome } from './decision'
import type { MiniAppWakeRequest } from './host-services'
import type { SemanticIndexHost } from './semantic'
import { askAgent, decide, rankByMeaning } from './judgment'

const chat = { userId: 'me', sessionId: 'chat-1' }
const withHost = (host?: Partial<NonNullable<MiniAppContext['host']>>) =>
  ({ host }) as MiniAppContext

function decisionsAnswering(outcome: DecisionOutcome, asked: unknown[] = []): DecisionHost {
  return {
    available: async () => ({ model: 'jev' }),
    decide: async (_userId, ask, options) => {
      asked.push({ ask, options })
      return outcome
    },
  }
}

const column = {
  ...chat,
  purpose: 'triage',
  state: { card: 'Fix the login button' },
  question: 'Which column does the card belong in?',
  options: { todo: 'Not started', doing: 'In progress', done: 'Finished' },
  fallback: 'todo' as const,
}

describe('decide', () => {
  test("takes the decision model's pick when it is confident, and says it did", async () => {
    const asked: unknown[] = []
    const ctx = withHost({
      decisions: decisionsAnswering(
        {
          status: 'answered',
          model: 'jev',
          ms: 40,
          answers: {
            answer: { type: 'choice', choice: 'doing', probabilities: { doing: 0.9, todo: 0.1 } },
          },
        },
        asked,
      ),
    })

    expect(await decide(ctx, column)).toEqual({ pick: 'doing', by: 'model' })
    expect(asked).toEqual([
      {
        ask: {
          state: column.state,
          questions: {
            answer: {
              type: 'choice',
              instructions: column.question,
              criteria: column.options,
            },
          },
        },
        options: { purpose: 'triage', sessionId: 'chat-1' },
      },
    ])
  })

  test('falls back, with the reason, when the model is unsure, absent or late', async () => {
    const unsure = withHost({
      decisions: decisionsAnswering({
        status: 'answered',
        model: 'jev',
        ms: 40,
        answers: {
          answer: { type: 'choice', choice: 'done', probabilities: { done: 0.5, todo: 0.5 } },
        },
      }),
    })
    const late = withHost({ decisions: decisionsAnswering({ status: 'deadline', ms: 3000 }) })

    expect(await decide(unsure, column)).toEqual({
      pick: 'todo',
      by: 'fallback',
      reason: 'unsure',
    })
    expect(await decide(late, column)).toEqual({ pick: 'todo', by: 'fallback', reason: 'deadline' })
    expect(await decide(withHost(undefined), column)).toEqual({
      pick: 'todo',
      by: 'fallback',
      reason: 'unavailable',
    })
  })
})

describe('rankByMeaning', () => {
  const items = [
    { id: 'a', text: 'Buy milk' },
    { id: 'b', text: 'Fix the bike' },
  ]

  test('orders items nearest in meaning first when the embedding model can run', async () => {
    const semantic = {
      // The bike is nearer to "repair" than the milk, whatever keys the candidates carry.
      rank: async (_query: string, candidates: { key: string; text: string }[]) => ({
        model: 'gemma',
        ranked: [...candidates]
          .sort((x, y) => Number(y.text.includes('bike')) - Number(x.text.includes('bike')))
          .map((candidate, index) => ({ key: candidate.key, cosine: 0.8 - index * 0.5 })),
      }),
    } as unknown as SemanticIndexHost

    expect(
      await rankByMeaning(withHost({ semantic }), 'repair', items, (item) => item.text),
    ).toEqual({ items: [items[1], items[0]], by: 'model' })
  })

  test('keeps the given order when it cannot', async () => {
    const semantic = { rank: async () => null } as unknown as SemanticIndexHost

    expect(
      await rankByMeaning(withHost({ semantic }), 'repair', items, (item) => item.text),
    ).toEqual({ items, by: 'fallback' })
    expect(await rankByMeaning(withHost(undefined), 'repair', items, (item) => item.text)).toEqual({
      items,
      by: 'fallback',
    })
  })
})

describe('askAgent', () => {
  test('starts a turn in the chat with the message and the tools to answer with', async () => {
    const woken: MiniAppWakeRequest[] = []
    const ctx = withHost({
      wake: async (request) => {
        woken.push(request)
        return { status: 'delivered' }
      },
    })

    const outcome = await askAgent(ctx, {
      ...chat,
      message: 'The person finished the workout.',
      tools: ['log_workout'],
    })

    expect(outcome).toEqual({ status: 'delivered' })
    expect(woken).toEqual([
      {
        userId: 'me',
        sessionId: 'chat-1',
        message: 'The person finished the workout.',
        tools: ['log_workout'],
      },
    ])
  })

  test('says why when this load cannot wake a chat, instead of throwing', async () => {
    expect(await askAgent(withHost(undefined), { ...chat, message: 'Hello' })).toEqual({
      status: 'missed',
      reason: 'This app cannot wake a chat here.',
    })
  })
})
