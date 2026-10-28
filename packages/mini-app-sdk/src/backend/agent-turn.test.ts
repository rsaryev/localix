import { expect, test } from 'bun:test'

import { askAgentForTurn, askDecisionForTurn, decisionTurns, type Wake } from './agent-turn'
import type { DecisionHost, DecisionOutcome } from './decision'

const chat = { userId: 'me', sessionId: 's1' }
const turn = { message: 'Your move.', tools: ['chess'], key: 'g:3' }

test('a delivered wake shows thinking and carries the chat and turn', async () => {
  const seen: unknown[] = []
  const wake: Wake = async (request) => {
    seen.push(request)
    return { status: 'delivered' }
  }
  expect(await askAgentForTurn(wake, chat, turn, 'T')).toEqual({ since: 'T', status: 'thinking' })
  expect(seen).toEqual([{ userId: 'me', sessionId: 's1', ...turn }])
})

test('an undelivered wake or a load without wake shows why nobody was asked', async () => {
  const refused: Wake = async () => ({ status: 'refused', reason: 'gone' })
  expect(await askAgentForTurn(refused, chat, turn, 'T')).toEqual({
    since: 'T',
    status: 'unreachable',
    reason: 'gone',
  })
  expect((await askAgentForTurn(undefined, chat, turn, 'T')).status).toBe('unreachable')
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

test('a decision answers with the pick of its one question, billed to the chat', async () => {
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
  expect(await askDecisionForTurn(decisions, chat, decisionTurn, 'T')).toEqual({
    answer: { type: 'choice', choice: 'b', probabilities: { a: 0.2, b: 0.8 } },
  })
  expect(seen).toEqual([{ userId: 'me', purpose: 'move', sessionId: 's1' }])
})

test('a decision without a playable pick shows why, like an undelivered wake', async () => {
  expect(await askDecisionForTurn(undefined, chat, decisionTurn, 'T')).toEqual({
    waiting: {
      since: 'T',
      status: 'unreachable',
      reason: 'This app cannot reach a decision model.',
    },
  })
  expect(
    await askDecisionForTurn(host({ status: 'unavailable', ms: 1 }), chat, decisionTurn, 'T'),
  ).toMatchObject({
    waiting: { reason: expect.stringContaining('No decision model is connected') },
  })
  const outside: DecisionOutcome = {
    status: 'answered',
    model: 'm',
    ms: 1,
    answers: { move: { type: 'choice', choice: 'z', probabilities: { z: 1 } } },
  }
  expect(await askDecisionForTurn(host(outside), chat, decisionTurn, 'T')).toMatchObject({
    waiting: { reason: 'The decision model could not answer.' },
  })
})

test('decision turns at one table run one after another, and idle waits for all of them', async () => {
  const turns = decisionTurns('test')
  const log: string[] = []
  let release = () => {}
  const first = new Promise<void>((resolve) => (release = resolve))
  turns.start(chat, async () => {
    log.push('first:start')
    await first
    log.push('first:end')
  })
  turns.start(chat, async () => {
    log.push('second')
  })
  // Another table is not held up by this one.
  turns.start({ ...chat, sessionId: 's2' }, async () => {
    log.push('other')
  })
  await Promise.resolve()
  await Promise.resolve()
  expect(log).toEqual(['first:start', 'other'])
  const idle = turns.idle()
  release()
  await idle
  expect(log).toEqual(['first:start', 'other', 'first:end', 'second'])
})

test('a decision turn that throws is logged, and the next one still runs', async () => {
  const turns = decisionTurns('test')
  const warn = console.warn
  const warned: unknown[] = []
  console.warn = (...args: unknown[]) => void warned.push(args[0])
  try {
    let ran = false
    turns.start(chat, async () => {
      throw new Error('store failed')
    })
    turns.start(chat, async () => {
      ran = true
    })
    await turns.idle()
    expect(ran).toBe(true)
    expect(warned).toEqual(["[test] the decision model's turn failed"])
  } finally {
    console.warn = warn
  }
})
