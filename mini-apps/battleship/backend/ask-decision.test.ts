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

import { applyShot, newGame, type Game } from '../shared/game'
import { SIZE, cellName, placeFleet, shipAt } from '../shared/rules'
import { DECISION_PURPOSE, shotAsk } from './ask-decision'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CHAT = { userId: 'u1', sessionId: 's1' }
const AT = '2026-10-20T10:00:00.000Z'

/** A seeded die, so every run places the same fleets. */
function seeded(seed = 7) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
}

/** A decision host that answers each ask with `pick(ask)`, or with the outcome it returns. */
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
            answers: { shot: { type: 'choice', choice: answer, probabilities: { [answer]: 0.9 } } },
          }
        : answer
    },
  }
  return { host, asked }
}

function setup(host?: DecisionHost) {
  const root = mkdtempSync(join(tmpdir(), 'battleship-decision-'))
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
    random: seeded(),
  })
  return { games, woke }
}

const cells = Array.from({ length: SIZE * SIZE }, (_, cell) => cell)
/** A cell of the user's fleet the agent side has not fired at, and one of plain water. */
const shipCell = (game: Game) => cells.find((cell) => shipAt(game.fleets.you, cell))!
const water = (game: Game, not: number[] = []) =>
  cells.find(
    (cell) =>
      !shipAt(game.fleets.you, cell) &&
      !not.includes(cell) &&
      !game.shots.some((shot) => shot.by === 'agent' && shot.cell === cell),
  )!
/** The person's first shot: water on the agent's board, so the turn passes. */
const missFor = (game: Game) => cells.find((cell) => !shipAt(game.fleets.agent, cell))!

describe('the question the decision model is asked', () => {
  test('it is built from the agent side alone: the user’s fleet changes nothing in it', () => {
    const random = seeded(3)
    const agent = placeFleet(random)
    const a = newGame({
      id: 'g',
      first: 'agent',
      fleets: { you: placeFleet(random), agent },
      now: AT,
    })
    const b = { ...a, fleets: { you: placeFleet(random), agent } }
    expect(shotAsk(b)).toEqual(shotAsk(a))
    expect(Object.keys(shotAsk(a).questions.shot!.criteria)).toHaveLength(SIZE * SIZE)
  })

  test('a hit afloat names the cells beside it, and two in line name the ends', () => {
    const random = seeded(11)
    const you = placeFleet(random)
    const four = you.find((ship) => ship.cells.length === 4)!
    const [first, second] = [...four.cells].sort((x, y) => x - y)
    let game = newGame({
      id: 'g',
      first: 'agent',
      fleets: { you, agent: placeFleet(random) },
      now: AT,
    })
    game = applyShot(game, 'agent', first!, AT)
    expect(shotAsk(game).state.cells_beside_an_afloat_hit).toContain(cellName(second!))
    game = applyShot(game, 'agent', second!, AT)
    const ends = shotAsk(game).state.cells_at_the_ends_of_a_line_of_hits as string[]
    expect(ends.length).toBeGreaterThan(0)
    expect(ends).not.toContain(cellName(first!))
    expect(shotAsk(game).state.opponent_ships_afloat_by_length).toEqual([
      4, 3, 3, 2, 2, 2, 1, 1, 1, 1,
    ])
  })
})

describe('against the decision model', () => {
  test('the person’s miss answers at once, and the model’s shots land after it, a hit earning another', async () => {
    let game: Game | null = null
    const picks: number[] = []
    const model = decisions((ask) => {
      // Then water among the cells still offered: a sunk ship's border is no longer one.
      const offered = new Set(Object.keys(ask.questions.shot!.criteria))
      const cell =
        picks.length === 0
          ? shipCell(game!)
          : cells.find((at) => offered.has(cellName(at)) && !shipAt(game!.fleets.you, at))!
      picks.push(cell)
      return cellName(cell)
    })
    const { games, woke } = setup(model.host)
    await games.setOpponent(CHAT, 'decision')
    game = await games.read(CHAT)
    // The request does not wait for the model: the person's shot is back with the model thinking.
    const shot = await games.personShot(CHAT, missFor(game))
    expect(shot.shots.filter((at) => at.by === 'you')).toHaveLength(1)
    expect(shot.shots.filter((at) => at.by === 'agent')).toEqual([])
    expect(shot.waiting).toMatchObject({ status: 'thinking' })
    await games.settled()
    const after = await games.read(CHAT)
    const theirs = after.shots.filter((at) => at.by === 'agent')
    expect(theirs.map((shot) => shot.result === 'miss')).toEqual([false, true])
    expect(after.turn).toBe('you')
    expect(after.waiting).toBeNull()
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('a miss of the model leaves the shot owed with the reason, and Ask again retries', async () => {
    let answer: string | DecisionOutcome = { status: 'unavailable', ms: 1 }
    const { games } = setup(decisions(() => answer).host)
    await games.setOpponent(CHAT, 'decision')
    const game = await games.read(CHAT)
    await games.personShot(CHAT, missFor(game))
    await games.settled()
    const missed = await games.read(CHAT)
    expect(missed.turn).toBe('agent')
    expect(missed.waiting).toMatchObject({
      status: 'unreachable',
      reason: expect.stringContaining('No decision model is connected'),
    })
    answer = cellName(water(missed))
    await games.remind(CHAT)
    await games.settled()
    expect((await games.read(CHAT)).turn).toBe('you')
  })

  test('switching while the agent side owes a shot asks the new opponent at once', async () => {
    let game: Game | null = null
    const { games, woke } = setup(decisions(() => cellName(water(game!))).host)
    await games.setOpponent(CHAT, 'agent')
    game = await games.read(CHAT)
    await games.personShot(CHAT, missFor(game))
    expect(woke).toHaveLength(1)
    await games.setOpponent(CHAT, 'decision')
    await games.settled()
    const after = await games.read(CHAT)
    expect(after.opponent).toBe('decision')
    expect(after.turn).toBe('you')
  })

  test('a new table plays the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(() => 'A1').host).games.read(CHAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(CHAT)).opponent).toBe('agent')
    expect((await setup().games.read(CHAT)).opponent).toBeNull()
  })

  test('a chosen opponent stays chosen, and carries to the next game', async () => {
    const { games } = setup(decisions(() => 'A1').host)
    await games.setOpponent(CHAT, 'agent')
    expect((await games.newGame(CHAT, 'you')).opponent).toBe('agent')
  })

  test('the agent cannot fire for the model, and a game it opens lets the user fire first', async () => {
    const { games } = setup(decisions(() => 'A1').host)
    await games.setOpponent(CHAT, 'decision')
    await expect(games.agentShot(CHAT, 0)).rejects.toThrow('The decision model plays your side')
    expect((await games.agentNewGame(CHAT, 'agent')).turn).toBe('you')
  })
})
