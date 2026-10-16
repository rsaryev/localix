import { describe, expect, test } from 'bun:test'

import { describeGame, drawBoard, recordLine, statusLine, threatLine } from './describe'
import { MoveRefused, applyMove, newGame, type Game } from './game'
import { gameUri, sessionOfGameUri } from './resource'

const AT = '2026-09-25T10:00:00.000Z'
const fresh = (overrides: Partial<Game> = {}): Game => ({
  ...newGame({ id: 'g1', first: 'X', now: AT }),
  ...overrides,
})
/** Play `cells` in order, alternating from whoever's turn it is. */
const playAll = (game: Game, cells: number[]): Game =>
  cells.reduce(
    (current, cell) => applyMove(current, cell, current.turn === 'X' ? 'you' : 'agent', AT),
    game,
  )

describe('the rules', () => {
  test('a move places the mark, passes the turn and is recorded', () => {
    const game = applyMove(fresh(), 4, 'you', AT)
    expect(game.board[4]).toBe('X')
    expect(game.turn).toBe('O')
    expect(game.moves).toEqual([{ cell: 4, mark: 'X', by: 'you', at: AT }])
  })

  test('every illegal move is refused with a sentence, and the game is untouched', () => {
    const played = applyMove(fresh(), 4, 'you', AT)
    expect(() => applyMove(played, 0, 'you', AT)).toThrow('Wait for the agent’s move.')
    expect(() => applyMove(fresh(), 0, 'agent', AT)).toThrow('It is the user’s turn (X).')
    expect(() => applyMove(played, 4, 'agent', AT)).toThrow('The centre (cell 5) is taken.')
    expect(() => applyMove(fresh(), 9, 'you', AT)).toThrow(MoveRefused)
    expect(played.moves).toHaveLength(1)
  })

  test('three in a row wins, names the line, and ends the game', () => {
    const game = playAll(fresh(), [0, 3, 1, 4, 2])
    expect(game.status).toBe('won')
    expect(game.line).toEqual([0, 1, 2])
    expect(() => applyMove(game, 8, 'agent', AT)).toThrow('This game is over.')
  })

  test('a full board with no line is a draw', () => {
    const game = playAll(fresh(), [0, 1, 2, 4, 3, 5, 7, 6, 8])
    expect(game.status).toBe('draw')
    expect(game.line).toBeNull()
  })

  test("the agent's move answers whatever it was asked; the user's leaves the wait alone", () => {
    const asked = { since: AT, status: 'thinking' as const }
    const waiting = { ...applyMove(fresh(), 4, 'you', AT), waiting: asked }
    expect(applyMove(waiting, 0, 'agent', AT).waiting).toBeNull()
    expect(applyMove(fresh({ waiting: asked }), 0, 'you', AT).waiting).toEqual(asked)
  })
})

describe('the score at the table', () => {
  test('each finished game counts once, from the person’s side; a game in play does not', () => {
    expect(playAll(fresh(), [0, 3]).record).toEqual({ won: 0, lost: 0, draw: 0 })
    expect(playAll(fresh(), [0, 3, 1, 4, 2]).record).toEqual({ won: 1, lost: 0, draw: 0 })
    expect(playAll(fresh(), [3, 0, 4, 1, 8, 2]).record).toEqual({ won: 0, lost: 1, draw: 0 })
  })

  test('the next game starts with the score it inherits', () => {
    const record = { won: 2, lost: 1, draw: 3 }
    expect(newGame({ id: 'g2', first: 'O', now: AT, record }).record).toEqual(record)
  })

  test('the agent reads it from its own side, and nothing before the first result', () => {
    expect(recordLine({ won: 0, lost: 0, draw: 0 })).toBeNull()
    expect(recordLine({ won: 2, lost: 1, draw: 3 })).toBe(
      'Score at this table: you 1, the user 2, draws 3.',
    )
  })
})

describe('the cell that decides the move', () => {
  // Move 3: X on 1, 3 and 4, O on 5 and 7 — the agent played 6 and lost on 2.
  test('names the block the agent missed', () => {
    const board: Game['board'] = ['X', null, 'X', 'X', 'O', null, 'O', null, null]
    expect(threatLine(fresh({ board, turn: 'O' }))).toBe(
      'The user wins next at cell 2 unless you take it.',
    )
  })

  test('a win of its own comes before a block', () => {
    // O can finish the middle column at 2; X could finish the left column at 7.
    const board: Game['board'] = ['X', null, null, 'X', 'O', null, null, 'O', null]
    expect(threatLine(fresh({ board, turn: 'O' }))).toBe('You win at cell 2.')
  })

  test('says nothing when no line is one move from done', () => {
    expect(
      threatLine(fresh({ board: ['X', null, null, null, 'O', null, null, null, null] })),
    ).toBeNull()
  })
})

describe('the game as text', () => {
  test('free cells show the number the move tool takes', () => {
    const game = applyMove(fresh(), 4, 'you', AT)
    expect(drawBoard(game)).toBe(
      [' 1 | 2 | 3', '---+---+---', ' 4 | X | 6', '---+---+---', ' 7 | 8 | 9'].join('\n'),
    )
    expect(statusLine(game)).toBe('Your turn (O).')
  })

  test('the description carries the last move, the turn and the free cells', () => {
    const text = describeGame(applyMove(fresh(), 4, 'you', AT))
    expect(text).toContain('The user played X in the centre (cell 5).')
    expect(text).toContain('Your turn (O).')
    expect(text).toContain('Free cells: 1, 2, 3, 4, 6, 7, 8, 9.')
  })

  test('a finished game says who won and with which line', () => {
    const game = playAll(fresh(), [3, 0, 4, 1, 8, 2])
    expect(statusLine(game)).toBe('You won with the top row.')
  })
})

describe('a board’s address', () => {
  test('a chat’s board URI names the chat, both ways; the bare one names none', () => {
    expect(sessionOfGameUri(gameUri('S/1 a'))).toBe('S/1 a')
    expect(sessionOfGameUri('localix://resource/tic-tac-toe/game')).toBeNull()
    expect(sessionOfGameUri('localix://resource/tic-tac-toe/other')).toBeUndefined()
    expect(sessionOfGameUri('localix://resource/tic-tac-toe/game/a/b')).toBeUndefined()
  })
})
