import { describe, expect, test } from 'bun:test'

import { legalDirections, newGame, shift, spawnTile } from './game'

const empty = (): number[] => Array<number>(16).fill(0)

describe('a move', () => {
  test('a pair merges once per move, and four of a kind become two pairs', () => {
    expect(shift([2, 2, 2, 2, ...empty().slice(4)], 'left')).toMatchObject({
      board: [4, 4, 0, 0, ...empty().slice(4)],
      points: 8,
      merges: [0, 1],
      changed: true,
    })
    expect(shift([4, 4, 8, 0, ...empty().slice(4)], 'left').board.slice(0, 4)).toEqual([8, 8, 0, 0])
  })

  test('says where every tile went, so the view moves the tile it drew', () => {
    expect(shift([0, 2, 0, 2, ...empty().slice(4)], 'left').tracks).toEqual([
      { from: 1, to: 0 },
      { from: 3, to: 0 },
    ])
    expect(shift([2, 0, 0, 4, ...empty().slice(4)], 'right').tracks).toEqual([
      { from: 3, to: 3 },
      { from: 0, to: 2 },
    ])
  })

  test('each direction shifts the intended rows or columns', () => {
    const board = [2, ...empty().slice(1)]
    expect(shift(board, 'right').board[3]).toBe(2)
    expect(shift(board, 'down').board[12]).toBe(2)
    expect(legalDirections(board)).toEqual(['down', 'right'])
  })

  test('a tile spawns only in a free cell, a 2 nine times in ten', () => {
    const board = [0, ...Array<number>(15).fill(2)]
    expect(spawnTile(board, () => 0)).toEqual({ cell: 0, value: 2 })
    expect(spawnTile(board, () => 0.99)).toEqual({ cell: 0, value: 4 })
    expect(spawnTile(Array<number>(16).fill(2), () => 0)).toBeNull()
  })

  test('a game starts with two tiles', () => {
    expect(
      newGame({ id: 'g1', mode: 'user', now: 'now', random: () => 0 }).board.filter(Boolean),
    ).toHaveLength(2)
  })
})
