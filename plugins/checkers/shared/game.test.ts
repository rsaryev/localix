import { describe, expect, test } from 'bun:test'

import { describeGame, drawBoard, recordLine, statusLine } from './describe'
import { MoveRefused, applyMove, newGame, resign, type Game } from './game'
import { moveName, parseSquares, squareAt } from './notation'
import { legalMoves, type Piece, type Square } from './rules'

const AT = '2026-09-25T10:00:00.000Z'
const fresh = (overrides: Partial<Game> = {}): Game => ({
  ...newGame({ id: 'g1', you: 'white', now: AT }),
  ...overrides,
})
const sq = (name: string) => squareAt(name)!
const man = (side: Piece['side']): Piece => ({ side, king: false })
const king = (side: Piece['side']): Piece => ({ side, king: true })
/** An empty board with `pieces` placed by name. */
const board = (pieces: Record<string, Piece>): Square[] => {
  const squares: Square[] = Array.from({ length: 64 }, () => null)
  for (const [name, piece] of Object.entries(pieces)) squares[sq(name)] = piece
  return squares
}
const names = (squares: Square[], side: Piece['side']) =>
  legalMoves(squares, side).map(moveName).sort()
/** Play moves written in notation, each by whoever is to move. */
const playAll = (game: Game, moves: string[]): Game =>
  moves.reduce(
    (current, move) =>
      applyMove(current, parseSquares(move), current.turn === current.you ? 'you' : 'agent', AT),
    game,
  )

describe('the rules of Russian draughts', () => {
  test('the opening: twelve men each, White to move, seven steps forward', () => {
    const game = fresh()
    expect(game.board.filter((piece) => piece?.side === 'white')).toHaveLength(12)
    expect(game.turn).toBe('white')
    expect(names(game.board, 'white')).toEqual([
      'a3-b4',
      'c3-b4',
      'c3-d4',
      'e3-d4',
      'e3-f4',
      'g3-f4',
      'g3-h4',
    ])
  })

  test('a capture is compulsory, and a man captures backwards too', () => {
    const squares = board({ d4: man('white'), c3: man('black'), h2: man('white') })
    expect(names(squares, 'white')).toEqual(['d4:b2'])
  })

  test('a capture that can go on must go on', () => {
    const squares = board({ c3: man('white'), d4: man('black'), f6: man('black') })
    expect(names(squares, 'white')).toEqual(['c3:e5:g7'])
  })

  test('a king flies, and must land where its capture goes on', () => {
    expect(names(board({ a1: king('white') }), 'white')).toHaveLength(7)
    // Past c3 it could land on d4 or e5; only from e5 does the capture go on, over f4.
    const squares = board({ a1: king('white'), c3: man('black'), f4: man('black') })
    expect(names(squares, 'white')).toEqual(['a1:e5:g3', 'a1:e5:h2'])
  })

  test('a man that stops short of the far row stays a man', () => {
    // c5 over d6 lands on e7, rank 7, and goes on as a man: one square over f6, to g5.
    const squares = board({ c5: man('white'), d6: man('black'), f6: man('black') })
    const plays = legalMoves(squares, 'white')
    expect(plays.map(moveName)).toEqual(['c5:e7:g5'])
    expect(plays[0]!.crowned).toBe(false)
  })

  test('a man crowned mid-capture goes on as a king', () => {
    // b6 over c7 lands on d8 and is crowned; the new king flies on over f6, to g5 or h4.
    const squares = board({ b6: man('white'), c7: man('black'), f6: man('black') })
    const plays = legalMoves(squares, 'white')
    expect(plays.map(moveName).sort()).toEqual(['b6:d8:g5', 'b6:d8:h4'])
    expect(plays.every((play) => play.crowned)).toBe(true)
  })

  test('a piece is never jumped twice, and a jumped piece blocks the way', () => {
    // A ring of men around c5: a king could circle it for ever if a jumped man left at once.
    const squares = board({
      a3: king('white'),
      b4: man('black'),
      d4: man('black'),
      b6: man('black'),
      d6: man('black'),
    })
    const plays = legalMoves(squares, 'white')
    expect(plays.length).toBeGreaterThan(0)
    for (const play of plays) expect(new Set(play.captured).size).toBe(play.captured.length)
  })
})

describe('a game', () => {
  test('a move passes the turn and is recorded; the pieces taken leave the board', () => {
    const game = playAll(fresh(), ['c3-d4', 'f6-e5', 'd4:f6'])
    expect(game.board[sq('f6')]).toEqual(man('white'))
    expect(game.board[sq('e5')]).toBeNull()
    expect(game.turn).toBe('black')
    expect(game.moves.at(-1)).toMatchObject({ from: sq('d4'), captured: [sq('e5')], by: 'you' })
  })

  test('every illegal move is refused with a sentence, and the game is untouched', () => {
    const played = playAll(fresh(), ['c3-d4'])
    expect(() => applyMove(played, parseSquares('e3-f4'), 'you', AT)).toThrow(
      'Wait for the agent’s move.',
    )
    expect(() => applyMove(fresh(), parseSquares('f6-e5'), 'agent', AT)).toThrow(
      'It is the user’s turn (white).',
    )
    expect(() => applyMove(fresh(), parseSquares('c3-c4'), 'you', AT)).toThrow(MoveRefused)
    const capture = playAll(fresh(), ['c3-d4', 'f6-e5'])
    expect(() => applyMove(capture, parseSquares('a3-b4'), 'you', AT)).toThrow(
      'A capture is compulsory. Legal moves: d4:f6.',
    )
    expect(played.moves).toHaveLength(1)
  })

  test('a start and an end name a capture when only one move joins them', () => {
    const game = applyMove(
      {
        ...fresh(),
        board: board({ c3: man('white'), d4: man('black'), f6: man('black'), h8: man('black') }),
      },
      parseSquares('c3 g7'),
      'you',
      AT,
    )
    expect(moveName(game.moves[0]!)).toBe('c3:e5:g7')
  })

  test('a side with no move left loses', () => {
    const game = applyMove(
      { ...fresh(), board: board({ c3: man('white'), d4: man('black') }) },
      parseSquares('c3:e5'),
      'you',
      AT,
    )
    expect(game.status).toBe('won')
    expect(game.ending).toBe('no-moves')
    expect(() => applyMove(game, parseSquares('e5-d6'), 'agent', AT)).toThrow('This game is over.')
  })

  test('fifteen king moves each without a capture is a draw', () => {
    const start = { ...fresh(), board: board({ a1: king('white'), h8: king('black') }), quiet: 29 }
    const game = applyMove(start, parseSquares('a1-b2'), 'you', AT)
    expect(game.status).toBe('draw')
    expect(game.ending).toBe('quiet')
  })

  test("the agent's move answers whatever it was asked; the user's leaves the wait", () => {
    const asked = { since: AT, status: 'thinking' as const }
    const waiting = { ...playAll(fresh(), ['c3-d4']), waiting: asked }
    expect(applyMove(waiting, parseSquares('f6-e5'), 'agent', AT).waiting).toBeNull()
    expect(applyMove(fresh({ waiting: asked }), parseSquares('c3-d4'), 'you', AT).waiting).toEqual(
      asked,
    )
  })
})

describe('resigning', () => {
  test('the agent resigns on either turn: the user wins, and it counts in the score', () => {
    for (const game of [fresh(), playAll(fresh(), ['c3-d4'])]) {
      const resigned = resign(game)
      expect(resigned.status).toBe('won')
      expect(resigned.ending).toBe('resign')
      expect(resigned.record).toEqual({ won: 1, lost: 0, draw: 0 })
      expect(statusLine(resigned)).toBe('The user won — you resigned.')
    }
  })

  test('a finished game cannot be resigned again', () => {
    expect(() => resign(resign(fresh()))).toThrow('This game is over already.')
  })
})

describe('the score at the table', () => {
  test('each finished game counts once, from the person’s side; a game in play does not', () => {
    const lone = { ...fresh(), board: board({ c3: man('white'), d4: man('black') }) }
    expect(playAll(fresh(), ['c3-d4']).record).toEqual({ won: 0, lost: 0, draw: 0 })
    expect(applyMove(lone, parseSquares('c3:e5'), 'you', AT).record).toEqual({
      won: 1,
      lost: 0,
      draw: 0,
    })
  })

  test('the next game starts with the score it inherits, and the agent reads it from its side', () => {
    const record = { won: 2, lost: 1, draw: 3 }
    expect(newGame({ id: 'g2', you: 'black', now: AT, record }).record).toEqual(record)
    expect(recordLine(record)).toBe('Score at this table: you 1, the user 2, draws 3.')
    expect(recordLine({ won: 0, lost: 0, draw: 0 })).toBeNull()
  })
})

describe('the game as text', () => {
  test('the board is drawn from White’s side with files and ranks', () => {
    const lines = drawBoard(fresh()).split('\n')
    expect(lines[0]).toBe('   a b c d e f g h')
    expect(lines[1]).toBe('8    b   b   b   b  8')
    expect(lines[8]).toBe('1  w   w   w   w    1')
  })

  test('the description carries the last move, the turn and the legal moves', () => {
    const text = describeGame(playAll(fresh(), ['c3-d4']))
    expect(text).toContain('The user played c3-d4.')
    expect(statusLine(playAll(fresh(), ['c3-d4']))).toBe('Your turn (black).')
    expect(text).toContain('Legal moves: ')
    expect(text).toContain('f6-e5')
  })
})
