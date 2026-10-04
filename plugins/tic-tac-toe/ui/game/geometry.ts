/**
 * The board's coordinates, in hundredths of its width: three tiles and two gaps of 3% each
 * (`gap-[3%]` in `Board.tsx`). Anything drawn OVER the tiles — the winning line, the sparks — is
 * placed from here, so it lands on a tile's centre at any board size instead of on a guess.
 */
export const GAP = 3
export const TILE = (100 - 2 * GAP) / 3

/** A cell's centre, 0–100 on each axis. */
export function cellCentre(cell: number): { x: number; y: number } {
  const at = (index: number) => index * (TILE + GAP) + TILE / 2
  return { x: at(cell % 3), y: at(Math.floor(cell / 3)) }
}
