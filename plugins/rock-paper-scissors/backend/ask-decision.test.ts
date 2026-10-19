import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DecisionAsk,
  DecisionHost,
  DecisionOptions,
  DecisionOutcome,
} from '@localixai/plugin-sdk/backend'
import { verifySealed } from '@localixai/plugin-sdk/sealed'

import { viewFor } from '../shared/game'
import { DECISION_PURPOSE } from './ask-decision'
import { createGameService } from './game-service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const SEAT = { userId: 'u1', sessionId: 's1' }
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
  const root = mkdtempSync(join(tmpdir(), 'rps-decision-'))
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
    newId: () => `id${++ids}`,
  })
  return { games, woke }
}

describe('against the decision model', () => {
  test('the person’s move is answered by the model’s sealed pick, revealed and verifiable', async () => {
    const model = decisions(() => 'paper')
    const { games, woke } = setup(model.host)
    const game = await games.personMove(SEAT, 'rock')
    expect(game.opponent).toBe('decision')
    expect(game.round.outcome).toBe('lost')
    expect(game.round.agent?.value).toBe('paper')
    const theirs = viewFor(game, 'you').round.theirs!
    expect(theirs.revealed).toBe(true)
    expect(await verifySealed(theirs)).toBe(true)
    expect(woke).toEqual([])
    expect(model.asked[0]!.options).toEqual({ purpose: DECISION_PURPOSE, sessionId: 's1' })
  })

  test('the model never sees the person’s move of the round in play', async () => {
    const model = decisions(() => 'paper')
    const { games } = setup(model.host)
    await games.personMove(SEAT, 'scissors')
    await games.nextRound(SEAT, 'you')
    await games.personMove(SEAT, 'rock')
    const [first, second] = model.asked.map(({ ask }) => ask.state)
    // What the state may hold: the rules, the finished rounds, the score and the round's number.
    for (const state of [first!, second!])
      expect(Object.keys(state).sort()).toEqual([
        'finished_rounds_oldest_first',
        'game',
        'score',
        'this_round',
        'you_play_against',
      ])
    expect(first!.finished_rounds_oldest_first).toEqual([])
    // The second ask knows round 1 — scissors against paper — and nothing of round 2's rock.
    expect(second!.finished_rounds_oldest_first).toEqual([
      { round: 1, person: 'scissors', you: 'paper', result: 'person won' },
    ])
    expect(model.asked[1]!.ask.state).toMatchObject({ this_round: 2 })
  })

  test('when the model opens, its move is sealed and the person sees only the digest', async () => {
    const { games } = setup(decisions(() => 'rock').host)
    await games.personMove(SEAT, 'paper')
    const opened = await games.nextRound(SEAT, 'agent')
    const view = viewFor(opened, 'you')
    expect(view.round.mine).toBeNull()
    expect(view.round.theirs).toMatchObject({ revealed: false })
    expect(JSON.stringify(view.round)).not.toContain('rock')
  })

  test('a miss leaves the move owed, with the reason the table shows, and Ask again retries', async () => {
    let answer: string | DecisionOutcome = { status: 'deadline', ms: 3000 }
    const { games } = setup(decisions(() => answer).host)
    const missed = await games.personMove(SEAT, 'rock')
    expect(missed.round.agent).toBeNull()
    expect(missed.waiting).toMatchObject({
      status: 'unreachable',
      reason: 'The decision model did not answer in time.',
    })
    answer = 'scissors'
    expect((await games.remind(SEAT)).round.outcome).toBe('won')
  })

  test('switching while the other seat owes a move asks the new opponent at once', async () => {
    const { games, woke } = setup(decisions(() => 'rock').host)
    await games.setOpponent(SEAT, 'agent')
    await games.personMove(SEAT, 'paper')
    expect(woke).toHaveLength(1)
    const game = await games.setOpponent(SEAT, 'decision')
    expect(game.round.outcome).toBe('won')
  })

  test('a new table plays the decision model when one can answer, else the agent', async () => {
    expect((await setup(decisions(() => 'rock').host).games.read(SEAT)).opponent).toBe('decision')
    const none: DecisionHost = {
      available: async () => null,
      decide: async () => ({ status: 'unavailable', ms: 0 }),
    }
    expect((await setup(none).games.read(SEAT)).opponent).toBe('agent')
    expect((await setup().games.read(SEAT)).opponent).toBeNull()
  })

  test('a chosen opponent stays chosen from round to round', async () => {
    const { games } = setup(decisions(() => 'rock').host)
    await games.setOpponent(SEAT, 'agent')
    expect((await games.nextRound(SEAT)).opponent).toBe('agent')
  })

  test('the agent cannot move for the model, and a round it opens lets the user open', async () => {
    const { games } = setup(decisions(() => 'rock').host)
    await games.read(SEAT)
    await expect(games.agentMove(SEAT, 'rock')).rejects.toThrow(
      'The decision model plays your side',
    )
    expect((await games.agentNextRound(SEAT, 'agent')).round.first).toBe('you')
  })
})
