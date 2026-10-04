import { CELLS, shift, type Step } from '../../shared/game'

/**
 * The board as TILES the view draws, each with an identity that survives a move.
 *
 * A board is sixteen numbers; a move is tiles travelling. To draw a tile sliding from the cell it
 * left, the view has to know which tile is which from one position to the next, so every tile gets
 * an id and a move carries it along its track (`shift(...).tracks`). Two tiles that merge both
 * slide into the cell and LEAVE; the merged tile is a new one that arrives there, as does the tile
 * that spawns — the shape of the original game's `mergedFrom`, which keeps a merge from being
 * drawn as one tile changing its number mid-slide.
 */
export interface Tile {
  id: number
  value: number
  cell: number
  /** How a tile that was not on the board before this move got there. */
  arrived?: 'spawn' | 'merge'
  /** A tile that merged into another: drawn sliding in, then gone at the next move. */
  leaving?: true
}

export interface Tiles {
  tiles: Tile[]
  /** The next id to hand out — only ever grows, so a key is never reused for another tile. */
  nextId: number
}

/** A board at rest: one tile per number, none of them moving. */
export function restingTiles(board: readonly number[], nextId = 1, arrived?: 'spawn'): Tiles {
  const tiles = board.flatMap((value, cell) =>
    value ? [{ id: nextId + cell, value, cell, ...(arrived ? { arrived } : {}) }] : [],
  )
  return { tiles, nextId: nextId + CELLS }
}

/** The numbers the tiles show — what the board is once every slide has landed. */
export function boardOf(tiles: readonly Tile[]): number[] {
  const board = Array<number>(CELLS).fill(0)
  for (const tile of tiles) if (!tile.leaving) board[tile.cell] = tile.value
  return board
}

/** The tiles after one move: every tile along its track, the merges and the spawn arriving. */
export function stepTiles(current: Tiles, step: Step): Tiles {
  const live = current.tiles.filter((tile) => !tile.leaving)
  const moved = shift(boardOf(live), step.direction)
  const byCell = new Map(live.map((tile) => [tile.cell, tile]))
  const merged = new Set(moved.merges)
  let nextId = current.nextId
  const tiles: Tile[] = moved.tracks.map(({ from, to }) => {
    const { id, value } = byCell.get(from)!
    return merged.has(to) ? { id, value, cell: to, leaving: true } : { id, value, cell: to }
  })
  for (const cell of moved.merges)
    tiles.push({ id: nextId++, value: moved.board[cell]!, cell, arrived: 'merge' })
  tiles.push({ id: nextId++, value: step.spawn.value, cell: step.spawn.cell, arrived: 'spawn' })
  return { tiles, nextId }
}
