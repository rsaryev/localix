import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { agentWaitSchema, type AgentWait } from '../agent-wait'
import { DECISION_HOLDS_SEAT, opponentSchema } from '../opponent'
import type { Seat, Wake } from './agent-turn'
import type { DecisionHost } from './decision'
import type { MiniAppWakeRequest } from './host-services'
import { createTurnTable } from './turn-table'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A toy game: the person and the agent take turns adding to a count, and the game is over at
 * `goal`. `agentTurns` is how many moves the agent owes in a row (a battleship hit keeps the turn).
 */
const gameSchema = z.object({
  id: z.string(),
  count: z.number(),
  goal: z.number(),
  owed: z.number(),
  status: z.enum(['playing', 'over']),
  opponent: opponentSchema,
  waiting: agentWaitSchema.nullable(),
})
type Game = z.infer<typeof gameSchema>

class Refused extends Error {}

const add = (game: Game, by: 'you' | 'agent', amount: number): Game => {
  if (game.status !== 'playing') throw new Refused('The game is over.')
  if ((by === 'agent') !== game.owed > 0) throw new Refused('Not your turn.')
  const count = game.count + amount
  return {
    ...game,
    count,
    owed: by === 'you' ? 1 : game.owed - 1,
    status: count >= game.goal ? 'over' : 'playing',
    waiting: by === 'agent' && game.owed > 1 ? game.waiting : null,
  }
}

const S1: Seat = { userId: 'u1', sessionId: 's1' }

function setup(
  options: {
    decisions?: DecisionHost
    resolveDir?: boolean
    agentRun?: number
    answers?: Array<{ amount: number } | { waiting: AgentWait }>
    beforeAnswer?: () => Promise<unknown>
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'turn-table-'))
  roots.push(root)
  const woke: MiniAppWakeRequest[] = []
  const wake: Wake = async (request) => {
    woke.push(request)
    return { status: 'delivered' }
  }
  const asked: Game[] = []
  const answers = [...(options.answers ?? [])]
  let ids = 0
  const table = createTurnTable<Game, { amount: number }>({
    plugin: 'toy',
    noun: 'board',
    ...(options.resolveDir === false
      ? {}
      : {
          resolveDir: async (_userId: string, sessionId: string) => {
            const dir = join(root, sessionId)
            mkdirSync(dir, { recursive: true })
            return dir
          },
        }),
    wake,
    ...(options.decisions ? { decisions: options.decisions } : {}),
    now: () => 'T',
    schema: gameSchema,
    initial: () => ({
      id: `g${++ids}`,
      count: 0,
      goal: 10,
      owed: 0,
      status: 'playing',
      opponent: null,
      waiting: null,
    }),
    owes: (game) => game.status === 'playing' && game.owed > 0,
    key: (game) => `${game.id}:${game.count}`,
    live: (game) => game.status === 'playing',
    agentTurn: (game) => ({ message: `count ${game.count}`, tools: ['toy'] }),
    askDecision: async (_decisions, _seat, game) => {
      asked.push(game)
      await options.beforeAnswer?.()
      return answers.shift() ?? { amount: 1 }
    },
    playDecision: (game, { amount }) => add({ ...game, waiting: null }, 'agent', amount),
    ...(options.agentRun ? { maxDecisionTurns: options.agentRun } : {}),
    refuse: (message) => new Refused(message),
  })
  return { table, woke, asked }
}

const decisionHost = (available: boolean): DecisionHost => ({
  available: async () => (available ? { model: 'm' } : null),
  decide: async () => ({ status: 'failed', ms: 0 }),
})

describe('a person’s turn', () => {
  test('is written first, then the agent is asked once for the position it owes', async () => {
    const { table, woke } = setup()
    const after = await table.personTurn(S1, (game) => add(game, 'you', 2))
    expect(after).toMatchObject({ count: 2, waiting: { status: 'thinking' } })
    expect(woke).toHaveLength(1)
    expect(woke[0]).toEqual({
      userId: 'u1',
      sessionId: 's1',
      message: 'count 2',
      tools: ['toy'],
      key: 'g1:2',
    })

    // A second action while the agent is thinking asks nobody; a reminder asks anyway.
    await table.personTurn(S1, (game) => game)
    expect(woke).toHaveLength(1)
    await table.remind(S1)
    expect(woke).toHaveLength(2)
  })

  test('that leaves nothing owed asks nobody', async () => {
    const { table, woke } = setup()
    expect((await table.read(S1)).count).toBe(0)
    await table.personTurn(S1, (game) => ({ ...game, goal: 20 }))
    expect(woke).toHaveLength(0)
  })

  test('a table without per-chat storage says it cannot hold the game', async () => {
    const { table } = setup({ resolveDir: false })
    await expect(table.read(S1)).rejects.toThrow(
      'This app keeps no per-chat data, so it cannot hold a board.',
    )
  })
})

describe('the agent’s turn', () => {
  test('says whether it answered the board’s own wait', async () => {
    const { table } = setup()
    await table.personTurn(S1, (game) => add(game, 'you', 1))
    const { game, answered } = await table.agentTurn(S1, (current) => add(current, 'agent', 1))
    expect(game).toMatchObject({ count: 2, waiting: null })
    expect(answered).toBe(true)

    await table.personTurn(S1, (current) => ({ ...add(current, 'you', 1), waiting: null }))
    await table.update(S1, (current) => ({ ...current, waiting: null }))
    expect((await table.agentTurn(S1, (current) => add(current, 'agent', 1))).answered).toBe(false)
  })

  test('is refused while the decision model holds the seat', async () => {
    const { table } = setup()
    await table.setOpponent(S1, 'decision')
    const turn = table.agentTurn(S1, (game) => game)
    await expect(turn).rejects.toBeInstanceOf(Refused)
    await expect(turn).rejects.toThrow(DECISION_HOLDS_SEAT)
    await expect(table.agentUpdate(S1, (game) => game)).rejects.toThrow(DECISION_HOLDS_SEAT)
  })
})

describe('the opponent', () => {
  test('settles on the decision model when one can answer, else the agent, and stays', async () => {
    expect((await setup({ decisions: decisionHost(true) }).table.read(S1)).opponent).toBe(
      'decision',
    )
    expect((await setup({ decisions: decisionHost(false) }).table.read(S1)).opponent).toBe('agent')
    // Only the backend load can ask: a tool call leaves the table unsettled.
    expect((await setup().table.read(S1)).opponent).toBeNull()
  })

  test('a new opponent is asked at once for the turn owed', async () => {
    const { table, woke, asked } = setup({ decisions: decisionHost(false) })
    await table.personTurn(S1, (game) => add(game, 'you', 1))
    expect(woke).toHaveLength(1)
    const switched = await table.setOpponent(S1, 'decision')
    expect(switched).toMatchObject({ opponent: 'decision', waiting: { status: 'thinking' } })
    await table.settled()
    expect(asked.map((game) => game.count)).toEqual([1])
    expect(await table.read(S1)).toMatchObject({ count: 2, owed: 0, waiting: null })
  })

  test('the decision model answers after the person’s request, and its move lands', async () => {
    const { table, woke, asked } = setup({ decisions: decisionHost(true) })
    const thinking = await table.personTurn(S1, (game) => add(game, 'you', 3))
    expect(thinking).toMatchObject({ count: 3, waiting: { status: 'thinking' } })
    await table.settled()
    expect(await table.read(S1)).toMatchObject({ count: 4, owed: 0, waiting: null })
    expect(asked.map((game) => game.count)).toEqual([3])
    expect(woke).toHaveLength(0)
  })

  test('a missed decision is recorded as the wait the view shows', async () => {
    const waiting: AgentWait = { since: 'T', status: 'unreachable', reason: 'late' }
    const { table } = setup({ decisions: decisionHost(true), answers: [{ waiting }] })
    await table.personTurn(S1, (game) => add(game, 'you', 1))
    await table.settled()
    expect(await table.read(S1)).toMatchObject({ count: 1, waiting })
  })

  test('a turn that keeps the seat is played on, up to the bound', async () => {
    const { table, asked } = setup({ decisions: decisionHost(true), agentRun: 2 })
    await table.update(S1, (game) => ({ ...game, owed: 3, opponent: 'decision' }))
    await table.remind(S1)
    await table.settled()
    expect(asked.map((game) => game.count)).toEqual([0, 1])
    expect((await table.read(S1)).owed).toBe(1)
  })

  test('a decision for a position that moved on is dropped', async () => {
    // The position moves while the model is asked: its answer is for a board that is gone.
    const moveOn = () => toy.table.update(S1, (game) => ({ ...game, owed: 0, count: 9 }))
    const toy = setup({ decisions: decisionHost(true), beforeAnswer: moveOn })
    const { table } = toy
    await table.personTurn(S1, (game) => add(game, 'you', 1))
    await table.settled()
    expect(await table.read(S1)).toMatchObject({ count: 9, owed: 0 })
  })
})
