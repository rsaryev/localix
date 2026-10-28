import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DecisionAsk,
  DecisionHost,
  DecisionOptions,
  DecisionOutcome,
  MiniAppRouteScope,
} from '@localixai/mini-app-sdk/backend'

import { gameSchema, newGame, STOPPED_REASON, type Game } from '../shared/game'
import { DECISION_PURPOSE, moveAsk } from './ask-decision'
import { createGameService } from './game-service'
import { createGameRoutes } from './routes'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CHAT = { userId: 'u1', sessionId: 's1' }

/** A decision host answering each ask with `pick(ask)`: a direction, or an outcome without one. */
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
            ms: 3,
            answers: { move: { type: 'choice', choice: answer, probabilities: { [answer]: 0.9 } } },
          }
        : answer
    },
  }
  return { host, asked }
}

/** The first direction the question offers — a legal move on any board. */
const firstOption = (ask: DecisionAsk) => Object.keys(ask.questions.move!.criteria)[0]!

function setup(host?: DecisionHost) {
  const root = mkdtempSync(join(tmpdir(), 'game-2048-decision-'))
  roots.push(root)
  const woke: unknown[] = []
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
    random: () => 0,
    newId: () => 'game-id',
    now: () => '2026-10-20T10:00:00.000Z',
  })
  return { games, woke }
}

describe('the question the decision model is asked', () => {
  test('the directions that move the board are the options, each with what it would do', () => {
    // 2 2 . . on the top row, everything else empty.
    const board = [2, 2, ...Array<number>(14).fill(0)]
    const game: Game = {
      ...newGame({ id: 'g', mode: 'agent', now: 'now', random: () => 0 }),
      board,
    }
    const ask = moveAsk(game)
    expect(Object.keys(ask.questions.move!.criteria).sort()).toEqual(['down', 'left', 'right'])
    expect(ask.state).toMatchObject({
      grid_rows_top_to_bottom: ['2 2 . .', '. . . .', '. . . .', '. . . .'],
      largest_tile: 2,
      what_each_direction_does: {
        left: { merges: 1, points: 4, empty_cells_after: 15, largest_tile_stays_in_a_corner: true },
        down: { merges: 0, points: 0, empty_cells_after: 14 },
      },
    })
  })
})

describe('when the decision model plays the board', () => {
  test('watching hands it the board: it plays move after move, billed to this chat', async () => {
    let calls = 0
    const model = decisions((ask) =>
      ++calls > 5 ? { status: 'deadline', ms: 1 } : firstOption(ask),
    )
    const { games, woke } = setup(model.host)
    await games.mode(CHAT, 'agent')
    await games.idle()
    const game = await games.read(CHAT)
    expect(game.opponent).toBe('decision')
    expect(game.moves).toBe(5)
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
    // The sixth decision missed: the board shows why, and Continue asks again.
    expect(game.waiting).toMatchObject({
      status: 'unreachable',
      reason: 'The decision model did not answer in time.',
    })
  })

  test('a miss shows its reason, and Continue plays on', async () => {
    let answer: (ask: DecisionAsk) => string | DecisionOutcome = () => ({
      status: 'unavailable',
      ms: 1,
    })
    const { games } = setup(decisions((ask) => answer(ask)).host)
    await games.mode(CHAT, 'agent')
    await games.idle()
    expect((await games.read(CHAT)).waiting?.reason).toContain('No decision model is connected')
    let left = 3
    answer = (ask) => (left-- > 0 ? firstOption(ask) : { status: 'failed', ms: 1 })
    await games.remind(CHAT)
    await games.idle()
    expect((await games.read(CHAT)).moves).toBe(3)
  })

  test('taking the board back stops the run, and the person moves again', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const host: DecisionHost = {
      available: async () => ({ model: 'decider' }),
      decide: async (_userId, ask) => {
        await gate
        const choice = firstOption(ask)
        return {
          status: 'answered',
          model: 'decider',
          ms: 1,
          answers: { move: { type: 'choice', choice, probabilities: { [choice]: 1 } } },
        }
      },
    }
    const { games } = setup(host)
    await games.mode(CHAT, 'agent')
    await games.mode(CHAT, 'user')
    release()
    await games.idle()
    const game = await games.read(CHAT)
    expect(game.moves).toBe(0)
    expect(game.mode).toBe('user')
  })

  test('Stop pauses the run before its next move, and Continue resumes it', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let asks = 0
    const host: DecisionHost = {
      available: async () => ({ model: 'decider' }),
      decide: async (_userId, ask) => {
        asks++
        await gate
        const choice = asks > 3 ? 'none' : firstOption(ask)
        return choice === 'none'
          ? { status: 'failed', ms: 1 }
          : {
              status: 'answered',
              model: 'decider',
              ms: 1,
              answers: { move: { type: 'choice', choice, probabilities: { [choice]: 1 } } },
            }
      },
    }
    const { games } = setup(host)
    await games.mode(CHAT, 'agent')
    const paused = await games.stop(CHAT)
    expect(paused.waiting).toMatchObject({ status: 'unreachable', reason: STOPPED_REASON })
    release()
    await games.idle()
    // The answer that was on its way when Stop landed is dropped.
    expect((await games.read(CHAT)).moves).toBe(0)
    await games.remind(CHAT)
    await games.idle()
    expect((await games.read(CHAT)).moves).toBeGreaterThan(0)
  })

  test('a stopped chat agent cannot move until Continue', async () => {
    const { games } = setup()
    await games.mode(CHAT, 'agent')
    await games.stop(CHAT)
    await expect(games.agentMoves(CHAT, { moves: ['left'] })).rejects.toThrow(
      'The user stopped you',
    )
  })

  test('the agent cannot move while the decision model holds the board', async () => {
    const { games } = setup(decisions(() => ({ status: 'failed', ms: 1 })).host)
    await games.mode(CHAT, 'agent')
    await games.idle()
    await expect(games.agentMoves(CHAT, { moves: ['left'] })).rejects.toThrow(
      'The decision model plays your side',
    )
  })
})

describe('who plays the board', () => {
  test('a new board takes the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(firstOption).host).games.read(CHAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(CHAT)).opponent).toBe('agent')
    // A tool call cannot ask, and leaves the board to settle on the next look from the view.
    expect((await setup().games.read(CHAT)).opponent).toBeNull()
  })

  test('a chosen player stays chosen, into the next game', async () => {
    const { games, woke } = setup(decisions(firstOption).host)
    await games.setOpponent(CHAT, 'agent')
    expect((await games.newGame(CHAT, 'agent')).opponent).toBe('agent')
    expect(woke).toHaveLength(1)
  })

  test('switching while watching hands the board to the new player at once', async () => {
    let moves = 2
    const { games, woke } = setup(
      decisions((ask) => (moves-- > 0 ? firstOption(ask) : { status: 'failed', ms: 1 })).host,
    )
    await games.setOpponent(CHAT, 'agent')
    await games.mode(CHAT, 'agent')
    expect(woke).toHaveLength(1)
    await games.setOpponent(CHAT, 'decision')
    await games.idle()
    expect((await games.read(CHAT)).moves).toBe(2)
  })

  test('the route sets the player, and refuses one it does not know', async () => {
    const root = mkdtempSync(join(tmpdir(), 'game-2048-route-'))
    roots.push(root)
    const app = createGameRoutes(
      createGameService({
        resolveDir: async (_userId, sessionId) => {
          const dir = join(root, sessionId)
          mkdirSync(dir, { recursive: true })
          return dir
        },
      }),
    )
    const scope: MiniAppRouteScope = { userId: 'u1', sessionId: 's1', projectId: '', cwd: '/' }
    const post = (body: unknown) =>
      app.request(
        '/game/opponent',
        {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        },
        scope,
      )
    const response = await post({ opponent: 'decision' })
    expect(response.status).toBe(200)
    expect(gameSchema.parse(await response.json()).opponent).toBe('decision')
    expect((await post({ opponent: 'someone' })).status).toBe(400)
  })
})
