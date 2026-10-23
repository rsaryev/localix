import { shotsBy, type PlayerView } from '../../shared/game'
import { SIZE, isSunk, knownCells, shipAt, sunkShips } from '../../shared/rules'

/**
 * What each of the hundred cells shows, on each of the two boards — derived from the person's view
 * alone, so the enemy board can only ever show what their shots revealed (the view carries nothing
 * else of the agent's fleet).
 *
 * - `unknown` — not fired at, nothing known: the only kind of enemy cell that takes a shot.
 * - `water` — a miss, or the border of a sunk ship (ships never touch, so it cannot hold one).
 * - `ship` — a ship cell the viewer may see: their own, or the enemy's once the game is over.
 * - `hit` — a hit on a ship still afloat. `sunk` — a cell of a sunk ship.
 */
export type CellState = 'unknown' | 'water' | 'ship' | 'hit' | 'sunk'

const cells = () => Array.from({ length: SIZE * SIZE }, (_, cell) => cell)

/** The person's own board, with the agent's shots on it. */
export function ownBoard(view: PlayerView): CellState[] {
  const shots = shotsBy(view, 'agent')
  const fired = new Set(shots)
  return cells().map((cell) => {
    const ship = shipAt(view.fleet, cell)
    if (!ship) return fired.has(cell) ? 'water' : 'unknown'
    if (!fired.has(cell)) return 'ship'
    return isSunk(ship, shots) ? 'sunk' : 'hit'
  })
}

/** The agent's board, as far as the person's shots revealed it. */
export function enemyBoard(view: PlayerView): CellState[] {
  const shots = shotsBy(view, 'you')
  const fired = new Set(shots)
  const hits = new Set(
    view.shots.filter((s) => s.by === 'you' && s.result !== 'miss').map((s) => s.cell),
  )
  const sunk = sunkShips(view.enemySeen, shots)
  const water = knownCells(sunk, shots)
  return cells().map((cell) => {
    if (shipAt(sunk, cell)) return 'sunk'
    if (hits.has(cell)) return 'hit'
    // After the game the whole fleet is in the view: the ships never found are shown.
    if (shipAt(view.enemySeen, cell)) return 'ship'
    return water.has(cell) || fired.has(cell) ? 'water' : 'unknown'
  })
}
