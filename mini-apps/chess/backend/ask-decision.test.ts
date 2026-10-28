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

import { applyMove, newGame, positionOfGame } from '../shared/game'
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

/** The first legal move the model is offered. */
const firstOption = (ask: DecisionAsk) => Object.keys(ask.questions.move!.criteria)[0]!

function setup(host?: DecisionHost) {
  const root = mkdtempSync(join(tmpdir(), 'chess-decision-'))
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
  test('the legal moves are the options, in SAN and in words, with the facts code can see', () => {
    let game = newGame({ id: 'g', you: 'white', now: AT })
    // Scholar's mate set up: black to move after 1.e4 e5 2.Qh5 Nc6 3.Bc4 — then white's Qxf7#.
    for (const [i, san] of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6'].entries())
      game = applyMove(game, san, i % 2 ? 'agent' : 'you', AT)
    // Give the decision model the white side for this position.
    const theirs = { ...game, you: 'black' as const }
    const ask = moveAsk(theirs)
    const criteria = ask.questions.move!.criteria as Record<string, string>
    expect(Object.keys(criteria)).toEqual(positionOfGame(theirs).legal.map((play) => play.san))
    expect(criteria['Qxf7#']).toBe('Queen h5 to f7, captures a pawn, checkmate')
    expect(criteria['Nf3']).toBe('Knight g1 to f3')
    expect(ask.state).toMatchObject({
      you_play: 'white',
      you_are_in_check: false,
      checkmating_moves: ['Qxf7#'],
    })
    expect((ask.state.captures as string[]).includes('Qxf7# takes a pawn')).toBe(true)
  })
})

describe('against the decision model', () => {
  test('the person’s move answers at once, and the model’s pick lands after it', async () => {
    const model = decisions(() => 'e5')
    const { games, woke } = setup(model.host)
    await games.setOpponent(CHAT, 'decision')
    // The request does not wait for the model: the person's move is back with the model thinking.
    const moved = await games.personMove(CHAT, 'e2e4')
    expect(moved.moves.map((move) => move.san)).toEqual(['e4'])
    expect(moved.waiting).toMatchObject({ status: 'thinking' })
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.moves.map((move) => move.san)).toEqual(['e4', 'e5'])
    expect(game.moves[1]!.by).toBe('agent')
    expect(game.waiting).toBeNull()
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('a miss leaves the move owed, with the reason the board shows, and Ask again retries', async () => {
    let answer: string | DecisionOutcome = { status: 'unavailable', ms: 1 }
    const { games } = setup(decisions(() => answer).host)
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, 'e2e4')
    await games.settled()
    const missed = await games.read(CHAT)
    expect(missed.moves).toHaveLength(1)
    expect(missed.waiting).toMatchObject({
      status: 'unreachable',
      reason: expect.stringContaining('No decision model is connected'),
    })
    answer = 'c5'
    await games.remind(CHAT)
    await games.settled()
    expect((await games.read(CHAT)).moves.at(-1)?.san).toBe('c5')
  })

  test('a new table plays the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(() => 'e5').host).games.read(CHAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(CHAT)).opponent).toBe('agent')
    // A tool call cannot ask, and leaves the table to settle on the next look from the board.
    expect((await setup().games.read(CHAT)).opponent).toBeNull()
  })

  test('a chosen opponent stays chosen', async () => {
    const { games } = setup(decisions(() => 'e5').host)
    await games.setOpponent(CHAT, 'agent')
    expect((await games.newGame(CHAT)).opponent).toBe('agent')
  })

  test('switching while the other colour owes a move asks the new opponent at once', async () => {
    const { games, woke } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'agent')
    await games.personMove(CHAT, 'e2e4')
    expect(woke).toHaveLength(1)
    await games.setOpponent(CHAT, 'decision')
    await games.settled()
    const game = await games.read(CHAT)
    expect(game.moves).toHaveLength(2)
    expect(game.opponent).toBe('decision')
  })

  test('the opponent carries to the next game, and the agent cannot move or resign for the model', async () => {
    const { games } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'decision')
    await games.personMove(CHAT, 'e2e4')
    await games.settled()
    // The next game gives the person black, so the model opens it at once.
    await games.newGame(CHAT)
    await games.settled()
    const next = await games.read(CHAT)
    expect(next.opponent).toBe('decision')
    expect(next.moves).toHaveLength(1)
    await expect(games.agentMove(CHAT, 'e7e5')).rejects.toThrow(
      'The decision model plays your side',
    )
    await expect(games.agentResign(CHAT)).rejects.toThrow('The decision model plays your side')
  })

  test('a new game the agent opens against the model lets the user play white', async () => {
    const { games } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'decision')
    const game = await games.agentNewGame(CHAT, 'black')
    expect(game.you).toBe('white')
    expect(game.moves).toEqual([])
  })
})
