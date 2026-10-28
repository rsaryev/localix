import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DecisionAsk,
  DecisionHost,
  DecisionOptions,
  DecisionOutcome,
} from '@localixai/mini-app-sdk/backend'

import { applyMove, newGame } from '../shared/game'
import { DECISION_PURPOSE, moveAsk } from './ask-decision'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CHAT = { userId: 'u1', sessionId: 's1' }
const AT = '2026-10-20T10:00:00.000Z'

/** A decision host that answers each ask with `pick`, or with `outcome` when it misses. */
function decisions(pick: (ask: DecisionAsk) => string | DecisionOutcome) {
  const asked: { ask: DecisionAsk; options: DecisionOptions }[] = []
  const host: DecisionHost = {
    available: async () => ({ model: 'decider' }),
    decide: async (_userId, ask, options) => {
      asked.push({ ask, options })
      const answer = pick(ask)
      return typeof answer === 'string'
        ? {
            status: 'answered',
            model: 'decider',
            ms: 4,
            answers: { move: { type: 'choice', choice: answer, probabilities: { [answer]: 0.9 } } },
          }
        : answer
    },
  }
  return { host, asked }
}

function setup(host?: DecisionHost) {
  const root = mkdtempSync(join(tmpdir(), 'tic-tac-toe-decision-'))
  roots.push(root)
  const woke: unknown[] = []
  let ids = 0
  const games = createGameService({
    resolveDir: async (_userId, sessionId) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
    wake: async (request) => {
      woke.push(request)
      return { status: 'delivered' }
    },
    ...(host ? { decisions: host } : {}),
    now: () => AT,
    newId: () => `g${++ids}`,
  })
  return { games, woke }
}

describe('the question the decision model is asked', () => {
  test('the free cells are the options, and the threats code can see are in the state', () => {
    let game = newGame({ id: 'g', first: 'X', now: AT })
    game = applyMove(game, 0, 'you', AT) // X top left
    game = applyMove(game, 4, 'agent', AT) // O centre
    game = applyMove(game, 1, 'you', AT) // X top: X wins next at 3
    const ask = moveAsk(game)
    expect(Object.keys(ask.questions.move!.criteria)).toEqual(['3', '4', '6', '7', '8', '9'])
    expect(ask.state).toMatchObject({
      you_play: 'O',
      board_rows_top_to_bottom: ['X X 3', '4 O 6', '7 8 9'],
      cells_where_o_wins_now: [],
      cells_where_x_wins_next: [3],
    })
  })
})

describe('against the decision model', () => {
  test('the person’s move answers at once, and the model’s pick lands after it', async () => {
    const model = decisions(() => '5')
    const { games, woke } = setup(model.host)
    await games.setOpponent(CHAT, 'decision')
    // The request does not wait for the model: the person's X is back with the model thinking.
    const moved = await games.personMove(CHAT, 0)
    expect(moved.board[0]).toBe('X')
    expect(moved.board[4]).toBeNull()
    expect(moved.waiting).toMatchObject({ status: 'thinking' })
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.board[4]).toBe('O')
    expect(game.turn).toBe('X')
    expect(game.waiting).toBeNull()
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('a miss leaves the move owed, with the reason the board shows, and Ask again retries', async () => {
    let answer: string | DecisionOutcome = { status: 'unavailable', ms: 1 }
    const { games } = setup(decisions(() => answer).host)
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, 0)
    await games.settled()
    const missed = await games.read(CHAT)
    expect(missed.turn).toBe('O')
    expect(missed.waiting).toMatchObject({
      status: 'unreachable',
      reason: expect.stringContaining('No decision model is connected'),
    })
    answer = '9'
    await games.remind(CHAT)
    await games.settled()
    expect((await games.read(CHAT)).board[8]).toBe('O')
  })

  test('a new table plays the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(() => '5').host).games.read(CHAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(CHAT)).opponent).toBe('agent')
    // A tool call cannot ask, and leaves the table to settle on the next look from the board.
    expect((await setup().games.read(CHAT)).opponent).toBeNull()
  })

  test('a chosen opponent stays chosen', async () => {
    const { games } = setup(decisions(() => '5').host)
    await games.setOpponent(CHAT, 'agent')
    expect((await games.newGame(CHAT)).opponent).toBe('agent')
  })

  test('switching while O owes a move asks the new opponent at once', async () => {
    const { games, woke } = setup(decisions(() => '1').host)
    await games.setOpponent(CHAT, 'agent')
    await games.personMove(CHAT, 4)
    expect(woke).toHaveLength(1)
    await games.setOpponent(CHAT, 'decision')
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.board[0]).toBe('O')
    expect(game.opponent).toBe('decision')
  })

  test('the opponent carries to the next game, and the agent cannot move for the model', async () => {
    const { games } = setup(decisions((ask) => Object.keys(ask.questions.move!.criteria)[0]!).host)
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, 4)
    expect((await games.newGame(CHAT)).opponent).toBe('decision')
    await expect(games.agentMove(CHAT, 0)).rejects.toThrow('The decision model plays your side')
  })

  test('a new game the agent opens against the model lets the user move first', async () => {
    const { games } = setup(decisions(() => '5').host)
    await games.setOpponent(CHAT, 'decision')
    expect((await games.agentNewGame(CHAT, 'O')).turn).toBe('X')
  })
})
