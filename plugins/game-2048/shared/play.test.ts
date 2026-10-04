import { describe, expect, test } from 'bun:test'

import { legalDirections, newGame, type Game } from './game'
import { applyMove, playMoves, replay } from './play'

const empty = (): number[] => Array<number>(16).fill(0)
const lone2 = () => [2, ...empty().slice(1)]
const withBoard = (board: number[], mode: Game['mode'] = 'agent'): Game => ({
  ...newGame({ id: 'g1', mode, now: 'then', random: () => 0 }),
  board,
})
const first = () => 0
const oneGap = () => [0, 2, 4, 8, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128]

describe('playing a list of moves', () => {
  // A plan of moves failed whole at its first no-op, though earlier moves had played.
  test('a move that would not change the board is skipped and the plan goes on', () => {
    const result = playMoves(
      withBoard(lone2()),
      { moves: ['left', 'right', 'left'] },
      'agent',
      'now',
      first,
    )
    expect(result.played).toEqual(['right', 'left'])
    expect(result.skipped).toEqual(['left'])
    expect(result.game.moves).toBe(2)
  })

  test('a plan of only no-ops changes nothing', () => {
    const game = withBoard(lone2())
    const result = playMoves(game, { moves: ['up', 'left'] }, 'agent', 'now', first)
    expect(result).toEqual({ game, played: [], skipped: ['up', 'left'], unplayed: 0, stop: null })
  })

  test('the plan stops where the game ends, and says how much was left', () => {
    const result = playMoves(
      withBoard(oneGap()),
      { moves: ['left', 'right', 'up'] },
      'agent',
      'now',
      first,
    )
    expect(result.game.status).toBe('over')
    expect(result).toMatchObject({ played: ['left'], unplayed: 2, stop: 'ended' })
    expect(legalDirections(result.game.board)).toEqual([])
  })

  test('a 2048 merge wins', () => {
    const won = playMoves(
      withBoard([1024, 1024, ...empty().slice(2)]),
      { moves: ['left', 'right'] },
      'agent',
      'now',
      first,
    )
    expect(won.game.status).toBe('won')
    expect(won.unplayed).toBe(1)
  })
})

describe('playing by preference', () => {
  // "down, else left, else right" was not expressible as a list; each move resolves it.
  test('each move takes the first preferred direction that changes the board then', () => {
    const result = playMoves(
      withBoard(lone2()),
      { prefer: ['up', 'left', 'down', 'right'], count: 3 },
      'agent',
      'now',
      first,
    )
    // up and left move nothing from the top left corner; down does, then the spawn decides.
    expect(result.played[0]).toBe('down')
    expect(result.played).toHaveLength(3)
    expect(result.skipped).toEqual([])
  })

  test('an order none of whose directions moves the board stops, and says so', () => {
    const result = playMoves(
      withBoard(lone2()),
      { prefer: ['up', 'left'], count: 5 },
      'agent',
      'now',
      first,
    )
    expect(result).toMatchObject({ played: [], unplayed: 5, stop: 'stuck' })
  })

  test('a full order plays until the count or the end of the game', () => {
    const result = playMoves(
      withBoard(oneGap()),
      { prefer: ['down', 'left', 'right', 'up'], count: 10 },
      'agent',
      'now',
      first,
    )
    expect(result).toMatchObject({ played: ['left'], unplayed: 9, stop: 'ended' })
  })
})

describe('a turn as the view replays it', () => {
  test('replays to exactly the board it produced', () => {
    const game = withBoard([2, 2, 0, 0, 4, ...empty().slice(5)])
    for (const plan of [
      { moves: ['left', 'down', 'right', 'up'] as const },
      { prefer: ['down', 'left', 'right', 'up'] as const, count: 12 },
    ]) {
      const result = playMoves(game, plan, 'agent', 'now', Math.random)
      expect(result.game.lastTurn?.from).toEqual(game.board)
      expect(result.game.lastTurn?.steps.map((step) => step.direction)).toEqual(result.played)
      expect(replay(result.game.lastTurn!.from, result.game.lastTurn!.steps)).toEqual(
        result.game.board,
      )
    }
  })
})

describe('who may move', () => {
  test('the agent playing marks it at the board; the person playing clears the wait', () => {
    const agent = playMoves(withBoard(lone2()), { moves: ['right'] }, 'agent', 'now', first)
    expect(agent.game.waiting).toEqual({ since: 'now', status: 'thinking' })
    expect(applyMove(withBoard(lone2(), 'user'), 'right', 'user', 'now', first).waiting).toBeNull()
  })

  test('the board is refused whole to the side that does not control it, or after the end', () => {
    expect(() =>
      playMoves(withBoard(lone2(), 'user'), { moves: ['right'] }, 'agent', 'now', first),
    ).toThrow('The user controls this board')
    expect(() => applyMove(withBoard(lone2()), 'right', 'user', 'now', first)).toThrow(
      'The agent controls this board',
    )
    const ended = { ...withBoard(lone2()), status: 'over' as const }
    expect(() => playMoves(ended, { moves: ['right'] }, 'agent', 'now', first)).toThrow('has ended')
  })

  test('a person’s move that would not change the board is refused', () => {
    expect(() => applyMove(withBoard(lone2(), 'user'), 'left', 'user', 'now', first)).toThrow(
      'cannot move left',
    )
  })
})
