import { describe, expect, test } from 'bun:test'

import { parseSquares, squareAt } from '../../shared/notation'
import { legalMoves, type Piece, type Square } from '../../shared/rules'
import { click, nextSquares } from './selection'

const sq = (name: string) => squareAt(name)!
const man = (side: Piece['side']): Piece => ({ side, king: false })
const board = (pieces: Record<string, Piece>): Square[] => {
  const squares: Square[] = Array.from({ length: 64 }, () => null)
  for (const [name, piece] of Object.entries(pieces)) squares[sq(name)] = piece
  return squares
}

describe('building a move from clicks', () => {
  const opening = legalMoves(
    board({ c3: man('white'), e3: man('white'), f6: man('black') }),
    'white',
  )

  test('a movable piece is picked; a square nothing can reach is ignored', () => {
    expect(click(opening, [], sq('c3'))).toEqual({ picked: [sq('c3')], send: null })
    expect(click(opening, [], sq('a1'))).toEqual({ picked: [], send: null })
  })

  test('a landing square completes a step and sends it', () => {
    expect(click(opening, [sq('c3')], sq('d4'))).toEqual({
      picked: [],
      send: parseSquares('c3-d4'),
    })
  })

  test('the picked piece clicked again is dropped; another piece is picked instead', () => {
    expect(click(opening, [sq('c3')], sq('c3')).picked).toEqual([])
    expect(click(opening, [sq('c3')], sq('e3')).picked).toEqual([sq('e3')])
  })

  test('a capture through several squares is built one landing at a time', () => {
    const legal = legalMoves(
      board({ c3: man('white'), d4: man('black'), f6: man('black'), a3: man('white') }),
      'white',
    )
    // A capture is compulsory, so only c3 may be picked up at all.
    expect(nextSquares(legal, [])).toEqual(new Set([sq('c3')]))
    const first = click(legal, [sq('c3')], sq('e5'))
    expect(first).toEqual({ picked: [sq('c3'), sq('e5')], send: null })
    expect(click(legal, first.picked, sq('g7')).send).toEqual(parseSquares('c3:e5:g7'))
  })
})
