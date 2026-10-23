import { describe, expect, test } from 'bun:test'

import { ShotRefused, applyShot, newGame, viewFor, type Game } from './game'
import {
  FLEET,
  cellAt,
  cellName,
  isLegalFleet,
  knownCells,
  neighbours,
  placeFleet,
  type Ship,
} from './rules'

const AT = '2026-09-26T10:00:00.000Z'
const c = (name: string) => cellAt(name)!
const ship = (...names: string[]): Ship => ({ cells: names.map(c) })

/** A fixed legal fleet: every ship along a row, two rows apart, so none touch. */
const FIXED: Ship[] = [
  ship('A1', 'B1', 'C1', 'D1'),
  ship('F1', 'G1', 'H1'),
  ship('A3', 'B3', 'C3'),
  ship('E3', 'F3'),
  ship('H3', 'I3'),
  ship('A5', 'B5'),
  ship('D5'),
  ship('F5'),
  ship('H5'),
  ship('J5'),
]

/** A seeded generator, so a random fleet is the same in every run. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

const fresh = (overrides: Partial<Game> = {}): Game => ({
  ...newGame({ id: 'g1', first: 'you', fleets: { you: FIXED, agent: FIXED }, now: AT }),
  ...overrides,
})
const fire = (game: Game, by: 'you' | 'agent', name: string) => applyShot(game, by, c(name), AT)

describe('the board', () => {
  test('cells read as a column letter and a row number, both ways', () => {
    expect(cellName(0)).toBe('A1')
    expect(cellName(99)).toBe('J10')
    expect(c('e5')).toBe(44)
    expect(cellAt('K1')).toBeNull()
    expect(cellAt('A11')).toBeNull()
  })

  test('a cell has eight neighbours inside the board, three in a corner, never itself', () => {
    expect(neighbours(c('E5'))).toHaveLength(8)
    expect(neighbours(c('A1')).map(cellName).sort()).toEqual(['A2', 'B1', 'B2'])
  })
})

describe('the fleet', () => {
  test('the fixed fleet is legal; touching, bent or missing ships are not', () => {
    expect(isLegalFleet(FIXED)).toBe(true)
    expect(isLegalFleet(FIXED.slice(1))).toBe(false)
    expect(isLegalFleet([...FIXED.slice(0, 9), ship('B2')])).toBe(false) // touches A1–D1 and A3
    expect(isLegalFleet([ship('A1', 'B1', 'C1', 'C2'), ...FIXED.slice(1)])).toBe(false)
  })

  test('a random fleet is always legal, with the classic ten ships', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const fleet = placeFleet(seeded(seed))
      expect(isLegalFleet(fleet)).toBe(true)
      expect(fleet.map((s) => s.cells.length)).toEqual([...FLEET])
    }
  })
})

describe('a shot', () => {
  test('a miss passes the turn; a hit earns another shot', () => {
    const missed = fire(fresh(), 'you', 'J10')
    expect(missed.turn).toBe('agent')
    expect(missed.shots.at(-1)).toMatchObject({ by: 'you', result: 'miss' })
    const hit = fire(fresh(), 'you', 'A1')
    expect(hit.turn).toBe('you')
    expect(hit.shots.at(-1)?.result).toBe('hit')
  })

  test('the last cell of a ship sinks it, and its whole border becomes known water', () => {
    const game = fire(fire(fresh(), 'you', 'E3'), 'you', 'F3')
    expect(game.shots.at(-1)?.result).toBe('sunk')
    const known = knownCells(FIXED, [c('E3'), c('F3')])
    expect(known.has(c('D2'))).toBe(true)
    expect(known.has(c('G4'))).toBe(true)
    expect(() => fire(game, 'you', 'G4')).toThrow('G4 is already known')
  })

  test('every refused shot says why, and the game is untouched', () => {
    const played = fire(fresh(), 'you', 'J10')
    expect(() => fire(played, 'you', 'J9')).toThrow('Wait for the agent’s shot.')
    expect(() => fire(fresh(), 'agent', 'A1')).toThrow('It is the user’s turn.')
    expect(() => fire(played, 'agent', 'A1')).not.toThrow()
    expect(() => applyShot(fresh(), 'you', 100, AT)).toThrow(ShotRefused)
    expect(played.shots).toHaveLength(1)
  })

  test('sinking the last ship wins, and the game is over', () => {
    const cells = FIXED.flatMap((s) => s.cells)
    const game = cells.reduce((current, cell) => applyShot(current, 'you', cell, AT), fresh())
    expect(game.status).toBe('won')
    expect(() => fire(game, 'agent', 'J10')).toThrow('This game is over.')
  })

  test("the wait ends when the agent's turn does: on a miss or a win, not on a hit", () => {
    const asked = { since: AT, status: 'thinking' as const }
    const agentTurn = { ...fire(fresh(), 'you', 'J10'), waiting: asked }
    expect(fire(agentTurn, 'agent', 'A1').waiting).toEqual(asked)
    expect(fire(agentTurn, 'agent', 'J10').waiting).toBeNull()
  })
})

describe('what each side may see', () => {
  test('the view carries its own fleet, and of the enemy only the sunk ships', () => {
    const game = fire(fire(fire(fresh(), 'you', 'D5'), 'you', 'A1'), 'you', 'J10')
    const view = viewFor(game, 'you')
    expect(view.fleet).toEqual(FIXED)
    expect(view.enemySeen).toEqual([ship('D5')])
    expect(JSON.stringify(view)).not.toContain('"fleets"')
  })

  test('once the game is over, the whole enemy fleet is revealed', () => {
    const cells = FIXED.flatMap((s) => s.cells)
    const game = cells.reduce((current, cell) => applyShot(current, 'you', cell, AT), fresh())
    expect(viewFor(game, 'agent').enemySeen).toEqual(FIXED)
  })
})
