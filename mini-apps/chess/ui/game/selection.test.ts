import { describe, expect, test } from 'bun:test'

import { positionOf, type Play } from '../../shared/position'
import { click, movable, promote, targetsOf } from './selection'

describe('building a move from clicks', () => {
  const opening = positionOf([]).legal

  test('a piece with a move is picked; one without, or an empty square, is not', () => {
    expect(movable(opening).has('e2')).toBe(true)
    expect(movable(opening).has('e1')).toBe(false)
    expect(click(opening, null, 'g1')).toEqual({ kind: 'pick', square: 'g1' })
    expect(click(opening, null, 'e4')).toEqual({ kind: 'drop' })
  })

  test('a target square sends the move in coordinates', () => {
    expect([...targetsOf(opening, 'g1')].sort()).toEqual(['f3', 'h3'])
    expect(click(opening, 'g1', 'f3')).toEqual({ kind: 'send', move: 'g1f3' })
  })

  test('the picked piece clicked again is dropped; another piece is picked instead', () => {
    expect(click(opening, 'g1', 'g1')).toEqual({ kind: 'drop' })
    expect(click(opening, 'g1', 'b1')).toEqual({ kind: 'pick', square: 'b1' })
  })

  test('a pawn reaching the last rank asks which piece before it sends', () => {
    const legal: Play[] = (['q', 'r', 'b', 'n'] as const).map((promotion) => ({
      san: `e8=${promotion.toUpperCase()}`,
      from: 'e7',
      to: 'e8',
      promotion,
      side: 'white',
    }))
    expect(click(legal, 'e7', 'e8')).toEqual({ kind: 'promote', from: 'e7', to: 'e8' })
    expect(promote('e7', 'e8', 'n')).toBe('e7e8n')
  })
})
