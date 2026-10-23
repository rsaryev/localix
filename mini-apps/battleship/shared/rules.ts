/**
 * The rules of Battleship as pure functions of a fleet and the shots at it: where ships may stand,
 * what a shot hits, and what each side has learned. Every caller — the routes, the tools and the
 * view — asks here, so none of them can disagree about a result.
 *
 * The classic rules, each of which a looser reading gets wrong:
 *
 * - Ten ships: one of four cells, two of three, three of two, four of one — straight lines.
 * - Ships never touch, not even at a corner, so a sunk ship's whole border is known to be water.
 * - A hit earns another shot; the turn passes only on a miss.
 *
 * Cells are indexed 0–99 row by row from the top left; people and the agent read them as a column
 * letter A–J and a row number 1–10 ("E5").
 */

export const SIZE = 10
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] as const

export interface Ship {
  cells: number[]
}

export type ShotResult = 'miss' | 'hit' | 'sunk'

export const rowOf = (cell: number) => Math.floor(cell / SIZE)
export const colOf = (cell: number) => cell % SIZE
const at = (row: number, col: number): number | null =>
  row < 0 || row >= SIZE || col < 0 || col >= SIZE ? null : row * SIZE + col

const COLUMNS = 'ABCDEFGHIJ'

/** "E5" — column letter, then row number. */
export const cellName = (cell: number): string => `${COLUMNS[colOf(cell)]}${rowOf(cell) + 1}`

/** The cell a name like "E5" or "j10" stands for, or null. */
export function cellAt(name: string): number | null {
  const match = /^\s*([a-j])\s*(10|[1-9])\s*$/i.exec(name)
  if (!match) return null
  return at(Number(match[2]) - 1, COLUMNS.indexOf(match[1]!.toUpperCase()))
}

/** The up-to-eight cells around `cell`. */
export function neighbours(cell: number): number[] {
  const around: number[] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const next = at(rowOf(cell) + dr, colOf(cell) + dc)
      if (next !== null) around.push(next)
    }
  return around
}

/** The ship standing on `cell`, if any. */
export const shipAt = (fleet: readonly Ship[], cell: number) =>
  fleet.find((ship) => ship.cells.includes(cell))

export const isSunk = (ship: Ship, shots: readonly number[]) =>
  ship.cells.every((cell) => shots.includes(cell))

export const sunkShips = (fleet: readonly Ship[], shots: readonly number[]) =>
  fleet.filter((ship) => isSunk(ship, shots))

export const allSunk = (fleet: readonly Ship[], shots: readonly number[]) =>
  fleet.every((ship) => isSunk(ship, shots))

/** What one more shot at `cell` does to `fleet`, given the shots already fired. */
export function shotResult(
  fleet: readonly Ship[],
  shots: readonly number[],
  cell: number,
): ShotResult {
  const ship = shipAt(fleet, cell)
  if (!ship) return 'miss'
  return isSunk(ship, [...shots, cell]) ? 'sunk' : 'hit'
}

/**
 * The cells the shooter already knows: every cell shot at, and the border of every sunk ship,
 * which the no-touching rule makes water. Firing at one of these again tells nothing.
 */
export function knownCells(fleet: readonly Ship[], shots: readonly number[]): Set<number> {
  const known = new Set(shots)
  for (const ship of sunkShips(fleet, shots))
    for (const cell of ship.cells) for (const near of neighbours(cell)) known.add(near)
  return known
}

/** Whether `fleet` is a legal fleet: the right ships, straight, in bounds and never touching. */
export function isLegalFleet(fleet: readonly Ship[]): boolean {
  const sizes = fleet.map((ship) => ship.cells.length).sort((a, b) => b - a)
  if (sizes.join() !== [...FLEET].join()) return false
  const taken = new Map<number, number>()
  for (const [index, ship] of fleet.entries()) {
    if (!isStraight(ship.cells)) return false
    for (const cell of ship.cells) {
      if (taken.has(cell)) return false
      taken.set(cell, index)
    }
  }
  return fleet.every((ship, index) =>
    ship.cells.every((cell) =>
      neighbours(cell).every((near) => (taken.get(near) ?? index) === index),
    ),
  )
}

function isStraight(cells: readonly number[]): boolean {
  if (
    cells.length === 0 ||
    cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE)
  )
    return false
  const sorted = [...cells].sort((a, b) => a - b)
  const sameRow = sorted.every((cell) => rowOf(cell) === rowOf(sorted[0]!))
  const step = sameRow ? 1 : SIZE
  if (!sameRow && !sorted.every((cell) => colOf(cell) === colOf(sorted[0]!))) return false
  return sorted.every((cell, i) => i === 0 || cell - sorted[i - 1]! === step)
}

/**
 * A random legal fleet. Largest ships first, each on a random free spot; a dead end (rare with ten
 * ships on a hundred cells) starts over, so the result is always legal and never a partial fleet.
 */
export function placeFleet(random: () => number = Math.random): Ship[] {
  for (;;) {
    const fleet = tryPlace(random)
    if (fleet) return fleet
  }
}

function tryPlace(random: () => number): Ship[] | null {
  const blocked = new Set<number>()
  const fleet: Ship[] = []
  for (const size of FLEET) {
    const spots: number[][] = []
    for (let cell = 0; cell < SIZE * SIZE; cell++)
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const cells = Array.from({ length: size }, (_, i) =>
          at(rowOf(cell) + dr * i, colOf(cell) + dc * i),
        )
        if (cells.every((c): c is number => c !== null && !blocked.has(c)))
          if (size > 1 || dr === 0) spots.push(cells as number[])
      }
    if (spots.length === 0) return null
    const cells = spots[Math.floor(random() * spots.length)]!
    fleet.push({ cells })
    for (const cell of cells) for (const near of [cell, ...neighbours(cell)]) blocked.add(near)
  }
  return fleet
}
