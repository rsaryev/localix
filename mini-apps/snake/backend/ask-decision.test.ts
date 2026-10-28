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

import { newGame, STOPPED_REASON, type Game } from '../shared/game'
import { DECISION_PURPOSE, moveAsk } from './ask-decision'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const CHAT = { userId: 'u1', sessionId: 's1' }
const AT = '2026-10-20T10:00:00.000Z'

/** A decision host that answers each ask with `pick`, or with an outcome when it misses. */
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
            ms: 2,
            answers: { move: { type: 'choice', choice: answer, probabilities: { [answer]: 0.9 } } },
          }
        : answer
    },
  }
  return { host, asked }
}

/** The heading the question rates safest: the option that does not die and reaches the most. */
const safest = (ask: DecisionAsk) => {
  const facts = (
    ask.state as {
      what_each_heading_does: Record<string, { dies: boolean; free_cells_reachable_after: number }>
    }
  ).what_each_heading_does
  return Object.entries(facts).sort(
    ([, a], [, b]) =>
      Number(a.dies) - Number(b.dies) ||
      b.free_cells_reachable_after - a.free_cells_reachable_after,
  )[0]![0]
}

function setup(host?: DecisionHost) {
  const root = mkdtempSync(join(tmpdir(), 'snake-decision-'))
  roots.push(root)
  const games = createGameService({
    resolveDir: async (_userId, sessionId) => {
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      return dir
    },
    ...(host ? { decisions: host } : {}),
    newSeed: () => 11,
    newId: () => 'game-id',
    now: () => AT,
    paceMs: 0,
  })
  return { games }
}

describe('the question the decision model is asked', () => {
  test('the headings the snake may take are the options, each with what it would do', () => {
    const game: Game = {
      ...newGame({ id: 'g', mode: 'model', now: AT, seed: 1 }),
      snake: [15, 14, 13],
      food: 31,
    }
    const ask = moveAsk(game)
    // Heading right: never straight back left, and right runs into the wall.
    expect(Object.keys(ask.questions.move!.criteria).sort()).toEqual(['down', 'right', 'up'])
    expect(ask.state).toMatchObject({
      heading: 'right',
      what_each_heading_does: {
        right: { dies: true, free_cells_reachable_after: 0 },
        up: { dies: true },
        down: { dies: false, eats_food: true, steps_to_food_after: 0 },
      },
    })
  })
})

describe('when the decision model plays', () => {
  test('handing it the board plays move after move, billed to this chat as a move', async () => {
    let left = 5
    const model = decisions((ask) => (left-- > 0 ? safest(ask) : { status: 'failed', ms: 1 }))
    const { games } = setup(model.host)
    await games.mode(CHAT, 'model')
    await games.idle()
    const game = await games.read(CHAT)
    expect(game.tick).toBe(5)
    expect(game.waiting).toMatchObject({
      status: 'unreachable',
      reason: 'The decision model could not answer.',
    })
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('without a decision model the board says why, and there is no other player', async () => {
    const { games } = setup()
    await games.mode(CHAT, 'model')
    await games.idle()
    expect((await games.read(CHAT)).waiting?.reason).toContain('cannot reach a decision model')
  })

  test('Stop drops the answer on its way, and Continue goes on from the same board', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    let asks = 0
    const host: DecisionHost = {
      available: async () => ({ model: 'decider' }),
      decide: async (_userId, ask) => {
        asks++
        await gate
        if (asks > 3) return { status: 'failed', ms: 1 }
        const choice = safest(ask)
        return {
          status: 'answered',
          model: 'decider',
          ms: 1,
          answers: { move: { type: 'choice', choice, probabilities: { [choice]: 1 } } },
        }
      },
    }
    const { games } = setup(host)
    await games.mode(CHAT, 'model')
    expect((await games.stop(CHAT)).waiting).toMatchObject({ reason: STOPPED_REASON })
    release()
    await games.idle()
    expect((await games.read(CHAT)).tick).toBe(0)
    await games.remind(CHAT)
    await games.idle()
    expect((await games.read(CHAT)).tick).toBeGreaterThan(0)
  })

  test('taking the board back stops the model, and the person’s turns are refused while it steers', async () => {
    const { games } = setup(decisions(() => ({ status: 'failed', ms: 1 })).host)
    await games.mode(CHAT, 'model')
    await games.idle()
    await expect(games.personTurns(CHAT, 0, ['right'])).rejects.toThrow('decision model steers')
    expect((await games.mode(CHAT, 'user')).waiting).toBeNull()
    expect((await games.personTurns(CHAT, 0, ['right', 'right'])).tick).toBe(2)
  })
})
