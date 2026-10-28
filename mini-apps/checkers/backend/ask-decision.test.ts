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
import { parseSquares } from '../shared/notation'
import { DECISION_PURPOSE, moveAsk } from './ask-decision'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CHAT = { userId: 'u1', sessionId: 's1' }
const AT = '2026-10-20T10:00:00.000Z'
const OPEN = parseSquares('c3-d4')

/** The first option the model is offered — always a legal move. */
const firstOption = (ask: DecisionAsk) => Object.keys(ask.questions.move!.criteria)[0]!

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
  const root = mkdtempSync(join(tmpdir(), 'checkers-decision-'))
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
  test('the legal moves are the options, and the facts code can see are in the state', () => {
    const game = applyMove(newGame({ id: 'g', you: 'white', now: AT }), OPEN, 'you', AT)
    const ask = moveAsk(game)
    const options = Object.keys(ask.questions.move!.criteria)
    expect(options).toContain('b6-a5')
    expect(options.every((name) => /^[a-h][1-8]-[a-h][1-8]$/.test(name))).toBe(true)
    expect(ask.state).toMatchObject({
      you_play: 'black',
      opponent_plays: 'white',
      pieces_left: { black: 12, white: 12 },
      capture_is_compulsory: false,
    })
  })

  test('when a capture is compulsory every option is one, with how many it takes', () => {
    let game = newGame({ id: 'g', you: 'white', now: AT })
    game = applyMove(game, parseSquares('c3-d4'), 'you', AT)
    game = applyMove(game, parseSquares('b6-a5'), 'agent', AT)
    // White steps next to d6: black must take it.
    game = applyMove(game, parseSquares('d4-c5'), 'you', AT)
    const ask = moveAsk(game)
    expect(ask.state).toMatchObject({ capture_is_compulsory: true })
    for (const description of Object.values(ask.questions.move!.criteria))
      expect(description).toContain('captures')
  })
})

describe('against the decision model', () => {
  test('the person’s move answers at once, and the model’s pick lands after it', async () => {
    const model = decisions(firstOption)
    const { games, woke } = setup(model.host)
    await games.setOpponent(CHAT, 'decision')
    // The request does not wait for the model: the person's move is back with the model thinking.
    const moved = await games.personMove(CHAT, OPEN)
    expect(moved.moves).toHaveLength(1)
    expect(moved.turn).toBe('black')
    expect(moved.waiting).toMatchObject({ status: 'thinking' })
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.moves).toHaveLength(2)
    expect(game.moves[1]).toMatchObject({ by: 'agent', side: 'black' })
    expect(game.turn).toBe('white')
    expect(game.waiting).toBeNull()
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('a miss leaves the move owed, with the reason the board shows, and Ask again retries', async () => {
    let answer: ((ask: DecisionAsk) => string) | DecisionOutcome = { status: 'unavailable', ms: 1 }
    const { games } = setup(
      decisions((ask) => (typeof answer === 'function' ? answer(ask) : answer)).host,
    )
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, OPEN)
    await games.settled()
    const missed = await games.read(CHAT)
    expect(missed.turn).toBe('black')
    expect(missed.waiting).toMatchObject({
      status: 'unreachable',
      reason: expect.stringContaining('No decision model is connected'),
    })
    answer = firstOption
    await games.remind(CHAT)
    await games.settled()
    expect((await games.read(CHAT)).turn).toBe('white')
  })

  test('a new table plays the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(firstOption).host).games.read(CHAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(CHAT)).opponent).toBe('agent')
    // A tool call cannot ask, and leaves the table to settle on the next look from the board.
    expect((await setup().games.read(CHAT)).opponent).toBeNull()
  })

  test('a chosen opponent stays chosen', async () => {
    const { games } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'agent')
    expect((await games.newGame(CHAT)).opponent).toBe('agent')
  })

  test('switching while the other colour owes a move asks the new opponent at once', async () => {
    const { games, woke } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'agent')
    await games.personMove(CHAT, OPEN)
    expect(woke).toHaveLength(1)
    await games.setOpponent(CHAT, 'decision')
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.moves).toHaveLength(2)
    expect(game.opponent).toBe('decision')
  })

  test('the opponent carries to the next game, and the agent cannot move or resign for it', async () => {
    const { games } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, OPEN)
    expect((await games.newGame(CHAT)).opponent).toBe('decision')
    await expect(games.agentMove(CHAT, parseSquares('c3-d4'))).rejects.toThrow(
      'The decision model plays your side',
    )
    await expect(games.agentResign(CHAT)).rejects.toThrow('The decision model plays your side')
  })

  test('a new game the agent opens against the model lets the user open as white', async () => {
    const { games } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'decision')
    const game = await games.agentNewGame(CHAT, 'black')
    expect(game.you).toBe('white')
    expect(game.turn).toBe('white')
  })
})
