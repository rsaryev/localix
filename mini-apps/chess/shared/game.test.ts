import { describe, expect, test } from 'bun:test'

import { describeGame, drawBoard, legalLine, movesLine, recordLine, statusLine } from './describe'
import { MoveRefused, applyMove, newGame, positionOfGame, resign, turnOf, type Game } from './game'
import { findPlay, type Play } from './position'

const AT = '2026-09-26T10:00:00.000Z'
const fresh = (overrides: Partial<Game> = {}): Game => ({
  ...newGame({ id: 'g1', you: 'white', now: AT }),
  ...overrides,
})
/** Play moves in order, each by whoever is to move. */
const playAll = (game: Game, moves: string[]): Game =>
  moves.reduce(
    (current, move) =>
      applyMove(current, move, turnOf(current) === current.you ? 'you' : 'agent', AT),
    game,
  )

const SCHOLARS_MATE = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']
/** Sam Loyd's ten-move stalemate. */
const LOYD_STALEMATE = [
  'e3',
  'a5',
  'Qh5',
  'Ra6',
  'Qxa5',
  'h5',
  'h4',
  'Rah6',
  'Qxc7',
  'f6',
  'Qxd7+',
  'Kf7',
  'Qxb7',
  'Qd3',
  'Qxb8',
  'Qh7',
  'Qxc8',
  'Kg6',
  'Qe6',
]

describe('the rules, through chess.js', () => {
  test('the opening: White to move, twenty legal moves', () => {
    const position = positionOfGame(fresh())
    expect(position.turn).toBe('white')
    expect(position.legal).toHaveLength(20)
  })

  test('a move is taken in SAN or in coordinates, and passes the turn', () => {
    const bySan = applyMove(fresh(), 'Nf3', 'you', AT)
    const byCoords = applyMove(fresh(), 'g1f3', 'you', AT)
    expect(bySan.moves[0]).toMatchObject({ san: 'Nf3', from: 'g1', to: 'f3', side: 'white' })
    expect(byCoords.moves[0]!.san).toBe('Nf3')
    expect(turnOf(bySan)).toBe('black')
  })

  test('every illegal move is refused with a sentence, and the game is untouched', () => {
    const played = applyMove(fresh(), 'e4', 'you', AT)
    expect(() => applyMove(played, 'd4', 'you', AT)).toThrow('Wait for the agent’s move.')
    expect(() => applyMove(fresh(), 'e5', 'agent', AT)).toThrow('It is the user’s turn (white).')
    expect(() => applyMove(fresh(), 'e5', 'you', AT)).toThrow(MoveRefused)
    expect(() => applyMove(fresh(), 'Ke2', 'you', AT)).toThrow('Legal moves: ')
    expect(played.moves).toHaveLength(1)
  })

  test('checkmate ends the game for the side that gave it', () => {
    const game = playAll(fresh(), SCHOLARS_MATE)
    expect(game.status).toBe('won')
    expect(game.ending).toBe('checkmate')
    expect(game.record).toEqual({ won: 1, lost: 0, draw: 0 })
    expect(() => applyMove(game, 'Ke7', 'agent', AT)).toThrow('This game is over.')
  })

  test('stalemate is a draw', () => {
    const game = playAll(fresh(), LOYD_STALEMATE)
    expect(game.status).toBe('draw')
    expect(game.ending).toBe('stalemate')
  })

  test('the same position three times is a draw', () => {
    const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8']
    const game = playAll(fresh(), [...shuffle, ...shuffle])
    expect(game.status).toBe('draw')
    expect(game.ending).toBe('threefold')
  })

  test("the agent's move answers whatever it was asked; the user's leaves the wait", () => {
    const asked = { since: AT, status: 'thinking' as const }
    const waiting = { ...playAll(fresh(), ['e4']), waiting: asked }
    expect(applyMove(waiting, 'e5', 'agent', AT).waiting).toBeNull()
    expect(applyMove(fresh({ waiting: asked }), 'e4', 'you', AT).waiting).toEqual(asked)
  })
})

describe('resigning', () => {
  test('the agent resigns on either turn: the user wins, and it counts in the score', () => {
    for (const game of [fresh(), playAll(fresh(), ['e4'])]) {
      const resigned = resign(game)
      expect(resigned).toMatchObject({ status: 'won', ending: 'resign' })
      expect(resigned.record).toEqual({ won: 1, lost: 0, draw: 0 })
      expect(statusLine(resigned)).toBe('The user won — you resigned.')
    }
    expect(() => resign(resign(fresh()))).toThrow('This game is over already.')
  })
})

describe('reading a typed move', () => {
  const legal: Play[] = [
    { san: 'O-O', from: 'e1', to: 'g1', side: 'white' },
    { san: 'Qh5+', from: 'd1', to: 'h5', side: 'white' },
    { san: 'e8=Q', from: 'e7', to: 'e8', promotion: 'q', side: 'white' },
    { san: 'e8=N', from: 'e7', to: 'e8', promotion: 'n', side: 'white' },
  ]

  test('check marks and zeros for castling do not matter', () => {
    expect(findPlay(legal, 'Qh5')?.san).toBe('Qh5+')
    expect(findPlay(legal, '0-0')?.san).toBe('O-O')
  })

  test('a promotion in coordinates is a queen unless another piece is named', () => {
    expect(findPlay(legal, 'e7e8')?.san).toBe('e8=Q')
    expect(findPlay(legal, 'e7e8n')?.san).toBe('e8=N')
    expect(findPlay(legal, 'a2a4')).toBeNull()
  })
})

describe('the game as text', () => {
  test('the board is drawn from White’s side, upper case white', () => {
    const lines = drawBoard(fresh()).split('\n')
    expect(lines[1]).toBe('8  r n b q k b n r  8')
    expect(lines[8]).toBe('1  R N B Q K B N R  1')
  })

  test('the description carries the last move, the turn, the FEN, the moves and the legal ones', () => {
    const game = playAll(fresh(), ['e4', 'e5', 'Nf3'])
    const text = describeGame(game)
    expect(text).toContain('The user played Nf3.')
    expect(statusLine(game)).toBe('Your turn (black).')
    expect(text).toContain('FEN: rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2')
    expect(movesLine(game)).toBe('Moves: 1. e4 e5 2. Nf3')
    expect(legalLine(game)).toContain('Nc6')
  })

  test('the score reads from the agent’s side', () => {
    expect(recordLine({ won: 2, lost: 1, draw: 3 })).toBe(
      'Score at this table: you 1, the user 2, draws 3.',
    )
  })
})
