import { SIZE } from '../../shared/game'

/**
 * The board's coordinates, in hundredths of its width: four tiles and five gaps (the two edges
 * included), `GAP` each. The empty cells and the tiles that slide over them are both placed from
 * here, so a tile lands exactly on its cell at any board size — the previous board laid the cells
 * out with a utility-class grid and faked the slide with an 18% nudge, so a tile never travelled
 * from the cell it left.
 */
export const GAP = 2.8
export const TILE = (100 - (SIZE + 1) * GAP) / SIZE

/** A cell's top left corner, 0–100 on each axis (the board is square). */
export function cellOrigin(cell: number): { x: number; y: number } {
  const at = (index: number) => GAP + index * (TILE + GAP)
  return { x: at(cell % SIZE), y: at(Math.floor(cell / SIZE)) }
}

/**
 * A tile's text size, in hundredths of the board's width (`cqi` of the board container): a
 * number fits its tile at any board width, and a longer number gets a smaller face instead of
 * spilling over the edge. The previous `5vw` followed the WINDOW, so a narrow pane in a wide window
 * printed 1024 wider than its tile.
 */
export function digitSize(value: number): number {
  const digits = String(value).length
  if (digits <= 2) return 10
  if (digits === 3) return 8.4
  if (digits === 4) return 6.6
  return 5.2
}
