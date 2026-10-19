import { expect, test } from 'bun:test'

import { askAgentForTurn, askDecisionForTurn, type Wake } from './agent-turn'
import type { DecisionHost, DecisionOutcome } from './decision'

const seat = { userId: 'me', sessionId: 's1' }
const turn = { message: 'Your move.', tools: ['chess'], key: 'g:3' }

test('a delivered wake shows thinking and carries the seat and turn', async () => {
  const seen: unknown[] = []
  const wake: Wake = async (request) => {
    seen.push(request)
    return { status: 'delivered' }
  }
  expect(await askAgentForTurn(wake, seat, turn, 'T')).toEqual({ since: 'T', status: 'thinking' })
  expect(seen).toEqual([{ userId: 'me', sessionId: 's1', ...turn }])
})

test('an undelivered wake or a load without wake shows why nobody was asked', async () => {
  const refused: Wake = async () => ({ status: 'refused', reason: 'gone' })
  expect(await askAgentForTurn(refused, seat, turn, 'T')).toEqual({
    since: 'T',
    status: 'unreachable',
    reason: 'gone',
  })
  expect((await askAgentForTurn(undefined, seat, turn, 'T')).status).toBe('unreachable')
})

const decisionTurn = {
  purpose: 'move',
  question: 'move',
  ask: {
    state: { board: '…' },
    questions: {
      move: { type: 'choice' as const, instructions: 'Which?', criteria: { a: 'A', b: 'B' } },
    },
  },
}
const host = (outcome: DecisionOutcome): DecisionHost => ({
  available: async () => ({ model: 'm' }),
  decide: async () => outcome,
})

test('a decision answers with the pick of its one question, billed to the seat', async () => {
  const seen: unknown[] = []
  const decisions: DecisionHost = {
    available: async () => ({ model: 'm' }),
    decide: async (userId, _ask, options) => {
      seen.push({ userId, ...options })
      return {
        status: 'answered',
        model: 'm',
        ms: 1,
        answers: { move: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } } },
      }
    },
  }
  expect(await askDecisionForTurn(decisions, seat, decisionTurn, 'T')).toEqual({
    answer: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } },
  })
  expect(seen).toEqual([{ userId: 'me', purpose: 'move', sessionId: 's1' }])
})

test('a decision without a playable pick shows why, like an undelivered wake', async () => {
  expect(await askDecisionForTurn(undefined, seat, decisionTurn, 'T')).toEqual({
    waiting: {
      since: 'T',
      status: 'unreachable',
      reason: 'This app cannot reach a decision model.',
    },
  })
  expect(
    await askDecisionForTurn(host({ status: 'unavailable', ms: 1 }), seat, decisionTurn, 'T'),
  ).toMatchObject({
    waiting: { reason: expect.stringContaining('No decision model is connected') },
  })
  const outside: DecisionOutcome = {
    status: 'answered',
    model: 'm',
    ms: 1,
    answers: { move: { type: 'choice', choice: 'z', probabilities: { z: 1 } } },
  }
  expect(await askDecisionForTurn(host(outside), seat, decisionTurn, 'T')).toMatchObject({
    waiting: { reason: 'The decision model could not answer.' },
  })
})
