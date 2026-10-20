import { describe, expect, test } from 'bun:test'

import {
  lookAhead,
  newGame,
  reachable,
  replay,
  SIZE,
  step,
  turns,
  type Direction,
  type Game,
} from './game'

const AT = '2026-10-20T10:00:00.000Z'
const fresh = (seed = 7) => newGame({ id: 'g', mode: 'user', now: AT, seed })
/** A game with the snake and food where a test wants them. */
const at = (snake: number[], food: number | null, heading: Game['heading'] = 'right'): Game => ({
  ...fresh(),
  snake,
  food,
  heading,
})

describe('one tick', () => {
  test('moves the head along the heading and the tail with it', () => {
    const game = at([34, 33, 32], 200)
    expect(step(game, 'right').snake).toEqual([35, 34, 33])
    expect(step(game, 'down').snake).toEqual([34 + SIZE, 34, 33])
  })

  test('a turn straight back into the body keeps the heading', () => {
    const game = at([34, 33, 32], 200)
    expect(turns(game)).not.toContain('left')
    expect(step(game, 'left').snake).toEqual([35, 34, 33])
  })

  test('food grows the snake, scores, raises the best and lays new food on a free cell', () => {
    const game = at([34, 33, 32], 35)
    const fed = step(game, 'right')
    expect(fed.snake).toEqual([35, 34, 33, 32])
    expect(fed.score).toBe(1)
    expect(fed.best).toBe(1)
    expect(fed.food).not.toBeNull()
    expect(fed.snake).not.toContain(fed.food)
  })

  test('a wall or the body ends the game', () => {
    expect(step(at([SIZE - 1, SIZE - 2], 200), 'right').status).toBe('over')
    // A loop whose head turns into its own body.
    const coiled = at([18, 17, 1, 2, 3, 19, 35, 34, 33], 200, 'right')
    expect(step(coiled, 'down').status).toBe('over')
  })

  test('the head may follow the tail into the cell it leaves', () => {
    const square = at([17, 1, 0, 16], 200, 'down')
    expect(lookAhead(square, 'left').dies).toBe(false)
  })
})

describe('the seeded board', () => {
  test('the same headings from the same game make the same board', () => {
    const headings = Array.from({ length: 40 }, (_, i): Direction => (i % 9 < 4 ? 'right' : 'down'))
    expect(replay(fresh(42), headings)).toEqual(replay(fresh(42), headings))
    expect(fresh(42).food).not.toBe(fresh(43).food)
  })

  test('a replay stops where the game ends', () => {
    const crashed = replay(fresh(), Array(20).fill('up'))
    expect(crashed.status).toBe('over')
    expect(crashed.tick).toBeLessThan(20)
  })
})

test('the free cells a head can reach, walled in by the body', () => {
  expect(reachable(0, [])).toBe(SIZE * SIZE)
  // A corner sealed off by two body cells.
  expect(reachable(0, [1, SIZE])).toBe(1)
  expect(reachable(null, [])).toBe(0)
})
