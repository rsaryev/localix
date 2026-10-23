import { describe, expect, test } from 'bun:test'
import { seal } from '@localixai/mini-app-sdk/backend'

import { describeForAgent, describeForChat } from './describe'
import {
  applyMove,
  HISTORY_LIMIT,
  MoveRefused,
  newGame,
  nextRound,
  outcomeOf,
  owesAgentMove,
  viewerMayMove,
  viewFor,
  viewOwesAgentMove,
  type Game,
  type Move,
  type Player,
} from './game'

const AT = '2026-10-18T10:00:00.000Z'
const game = (first: Player = 'you') => newGame({ id: 't1', roundId: 'r1', first, now: AT })
const play = (current: Game, player: Player, move: Move) =>
  applyMove(current, seal(move, player, AT), AT)

describe('the rules', () => {
  test.each([
    ['rock', 'scissors', 'won'],
    ['scissors', 'paper', 'won'],
    ['paper', 'rock', 'won'],
    ['rock', 'paper', 'lost'],
    ['paper', 'paper', 'draw'],
  ] as const)('%s against %s: %s', (you, agent, outcome) => {
    expect(outcomeOf(you, agent)).toBe(outcome)
  })

  test('the opener moves first; the second move reveals and scores the round', () => {
    let current = game('agent')
    expect(owesAgentMove(current)).toBe(true)
    expect(() => play(current, 'you', 'rock')).toThrow(MoveRefused)

    current = play(current, 'agent', 'paper')
    expect(current.round.agent?.revealedAt).toBeNull()
    expect(owesAgentMove(current)).toBe(false)

    current = play(current, 'you', 'scissors')
    expect(current.round.outcome).toBe('won')
    expect(current.round.agent?.revealedAt).toBe(AT)
    expect(current.round.you?.revealedAt).toBe(AT)
    expect(current.record).toEqual({ won: 1, lost: 0, draw: 0 })
    expect(current.history).toHaveLength(1)
  })

  test('nobody moves twice, and a finished round takes no move', () => {
    const sealed = play(game(), 'you', 'rock')
    expect(() => play(sealed, 'you', 'paper')).toThrow('You already chose')
    const done = play(sealed, 'agent', 'rock')
    expect(() => play(done, 'agent', 'rock')).toThrow('This round is over')
  })

  test('a move outside the three is refused', () => {
    expect(() => applyMove(game(), seal('lizard', 'you', AT), AT)).toThrow(
      'rock, paper or scissors',
    )
  })

  test('the next round alternates the opener, keeps the score and bounds the history', () => {
    let current = game()
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      const opener = current.round.first
      current = play(play(current, opener, 'rock'), opener === 'you' ? 'agent' : 'you', 'rock')
      current = nextRound(current, { id: `r${i + 2}`, now: AT })
      expect(current.round.first).not.toBe(opener)
    }
    expect(current.history).toHaveLength(HISTORY_LIMIT)
    expect(current.record.draw).toBe(HISTORY_LIMIT + 2)
  })
})

describe('what each player may see', () => {
  test('the agent’s sealed move reaches the person as a digest only', () => {
    const current = play(game('agent'), 'agent', 'scissors')
    const view = viewFor(current, 'you')
    expect(view.round.theirs).toEqual({
      revealed: false,
      owner: 'agent',
      digest: current.round.agent!.digest,
    })
    expect(JSON.stringify(view)).not.toContain('scissors')
    expect(JSON.stringify(view)).not.toContain(current.round.agent!.salt)
    expect(viewerMayMove(view)).toBe(true)
  })

  test('the person’s sealed move reaches the agent, its wake and the chat context as a digest only', () => {
    const current = play(game('you'), 'you', 'paper')
    const agentView = viewFor(current, 'agent')
    expect(JSON.stringify(agentView)).not.toContain('paper')
    expect(viewOwesAgentMove(agentView)).toBe(true)
    expect(describeForAgent(agentView)).toContain('the user has sealed their move')
    expect(describeForAgent(agentView)).not.toContain('paper')
    // The chat context is the person's view, read by the agent.
    expect(describeForChat(viewFor(current, 'you'))).not.toContain('paper')
  })

  test('the agent’s own sealed move never appears in its own text — results are shown to the user', () => {
    const current = play(game('agent'), 'agent', 'rock')
    expect(describeForAgent(viewFor(current, 'agent'))).not.toContain('rock')
  })

  test('a revealed round shows both moves to both sides', () => {
    const current = play(play(game(), 'you', 'rock'), 'agent', 'paper')
    expect(viewFor(current, 'you').round).toMatchObject({
      mine: 'rock',
      theirs: { revealed: true, value: 'paper' },
      outcome: 'lost',
    })
    expect(describeForAgent(viewFor(current, 'agent'))).toContain(
      'the user played rock, you played paper — you won',
    )
  })
})
