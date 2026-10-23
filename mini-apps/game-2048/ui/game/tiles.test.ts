import { describe, expect, test } from 'bun:test'

import { newGame, type Step } from '../../shared/game'
import { playMoves, replay } from '../../shared/play'
import { cellOrigin, digitSize, GAP, TILE } from './geometry'
import { boardOf, restingTiles, stepTiles } from './tiles'

const empty = (): number[] => Array<number>(16).fill(0)

describe('tiles that survive a move', () => {
  test('a sliding tile keeps its id and changes only its cell', () => {
    const start = restingTiles([2, ...empty().slice(1)])
    const step: Step = { direction: 'right', spawn: { cell: 0, value: 2 } }
    const [slid, spawned] = stepTiles(start, step).tiles
    expect(slid).toEqual({ id: start.tiles[0]!.id, value: 2, cell: 3 })
    expect(spawned).toMatchObject({ cell: 0, value: 2, arrived: 'spawn' })
  })

  test('two merging tiles both slide in and leave; the merged tile arrives as a new one', () => {
    const start = restingTiles([2, 0, 0, 2, ...empty().slice(4)])
    const after = stepTiles(start, { direction: 'left', spawn: { cell: 15, value: 4 } })
    expect(after.tiles.filter((tile) => tile.leaving).map((tile) => tile.cell)).toEqual([0, 0])
    expect(after.tiles.find((tile) => tile.arrived === 'merge')).toMatchObject({
      cell: 0,
      value: 4,
    })
    expect(new Set(after.tiles.map((tile) => tile.id)).size).toBe(after.tiles.length)
    // The next move forgets the tiles that left.
    const next = stepTiles(after, { direction: 'right', spawn: { cell: 0, value: 2 } })
    expect(next.tiles.some((tile) => tile.leaving)).toBe(false)
  })

  // The view's replay and the rules must land on the same board, move for move.
  test('replaying a recorded turn tile by tile ends on the board the rules produced', () => {
    let game = { ...newGame({ id: 'g', mode: 'agent', now: 'n', random: Math.random }) }
    let tiles = restingTiles(game.board)
    for (let turn = 0; turn < 20 && game.status === 'playing'; turn++) {
      const played = playMoves(
        game,
        { prefer: ['down', 'left', 'right', 'up'], count: 8 },
        'agent',
        'n',
        Math.random,
      )
      if (!played.game.lastTurn) break
      for (const step of played.game.lastTurn.steps) tiles = stepTiles(tiles, step)
      expect(boardOf(tiles.tiles)).toEqual(played.game.board)
      expect(replay(played.game.lastTurn.from, played.game.lastTurn.steps)).toEqual(
        played.game.board,
      )
      game = played.game
    }
  })
})

describe('the board’s geometry', () => {
  test('four tiles and five gaps fill the board exactly', () => {
    expect(4 * TILE + 5 * GAP).toBeCloseTo(100)
    expect(cellOrigin(0)).toEqual({ x: GAP, y: GAP })
    expect(cellOrigin(15).x + TILE + GAP).toBeCloseTo(100)
    expect(cellOrigin(4).x).toBe(cellOrigin(0).x)
    expect(cellOrigin(1).y).toBe(cellOrigin(0).y)
  })

  test('a longer number gets a smaller face that still fits its tile', () => {
    const sizes = [2, 64, 128, 2048, 16384].map(digitSize)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    // A face this size is at most ~0.62 of its height wide per digit: the number stays inside.
    for (const value of [8, 512, 4096, 65536])
      expect(String(value).length * digitSize(value) * 0.62).toBeLessThan(TILE)
  })
})
