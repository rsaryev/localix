import { useFocusEntry } from '@localixai/mini-app-sdk/ui/focus'
import { useId, useMemo, useRef, type CSSProperties, type PointerEvent } from 'react'

import { CELLS, legalDirections, SIZE, type Direction, type Game } from '../../shared/game'
import { cellOrigin, digitSize, TILE } from './geometry'
import { useTiles } from './useTiles'
import './board.css'

/**
 * The board: sixteen cells, and the tiles that travel over them.
 *
 * The cells are drawn once and never move; each tile is its own element, placed on a cell from
 * `geometry.ts` and carried to the next cell by a transition on that placement — so a tile slides
 * from the cell it left, and the board keeps its shape empty or full. The board is a size
 * container, so a tile's number scales with the BOARD (`digitSize`), not with the window.
 *
 * The person plays with the arrow keys or a swipe on the board; both take only a direction that
 * moves the board, so a key that would do nothing sends nothing.
 */

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
/** A drag shorter than this is a tap, not a move. */
const SWIPE_PX = 24

/**
 * The board's geometry, INLINE on purpose: everything on it is placed in board coordinates, and
 * an inline style cannot be dropped by the host's de-duplicated sheet or out-ranked.
 */
const BOARD: CSSProperties = {
  position: 'relative',
  aspectRatio: '1 / 1',
  containerType: 'inline-size',
  touchAction: 'none',
}

function place(cell: number): CSSProperties {
  const { x, y } = cellOrigin(cell)
  return { left: `${x}%`, top: `${y}%`, width: `${TILE}%`, height: `${TILE}%` }
}

/** The board in words, row by row, for a screen reader. */
function boardLabel(board: readonly number[]): string {
  const rows = Array.from({ length: SIZE }, (_, row) =>
    board
      .slice(row * SIZE, row * SIZE + SIZE)
      .map((value) => value || 'empty')
      .join(', '),
  )
  return `2048 board. ${rows.map((row, index) => `Row ${index + 1}: ${row}.`).join(' ')}`
}

/** The arrow keys play a direction while the board is the person's and nothing else has focus. */
function useArrowKeys(
  enabled: boolean,
  legal: readonly Direction[],
  onMove: (d: Direction) => void,
  scope: () => Element | null,
) {
  const id = useId()
  useFocusEntry({
    id: `2048:${id}`,
    kind: 'surface',
    active: enabled,
    scope,
    onKeyDown: (event) => {
      const direction = KEYS[event.key]
      if (!direction || event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            'input, textarea, select, [role="textbox"], [role="dialog"], [role="radiogroup"]',
          ))
      )
        return
      event.preventDefault()
      if (legal.includes(direction)) onMove(direction)
      return true
    },
  })
}

export function Board({
  game,
  playable,
  onMove,
}: {
  game: Game
  /** The person may move now: their board, the game on, nothing in flight. */
  playable: boolean
  onMove: (direction: Direction) => void
}) {
  const tiles = useTiles(game)
  const legal = useMemo(() => legalDirections(game.board), [game.board])
  const boardRef = useRef<HTMLDivElement>(null)
  useArrowKeys(playable, legal, onMove, () => boardRef.current)

  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (playable) boardRef.current?.focus({ preventScroll: true })
    swipe.current = playable ? { x: event.clientX, y: event.clientY } : null
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current
    swipe.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return
    const direction: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    if (legal.includes(direction)) onMove(direction)
  }

  return (
    <div
      ref={boardRef}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-played board: the arrow keys act on it, so it must be the focus target; role="application" is the ARIA role for exactly that
      tabIndex={0}
      role="application"
      aria-label={boardLabel(game.board)}
      data-won={game.status === 'won' ? 'true' : undefined}
      className="game-2048-board focus-ring"
      style={BOARD}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipe.current = null
      }}
    >
      {Array.from({ length: CELLS }, (_, cell) => (
        <div key={`cell-${cell}`} className="game-2048-cell" style={place(cell)} />
      ))}
      {tiles.map((tile) => (
        <div
          key={tile.id}
          className="game-2048-tile"
          data-value={tile.value > 2048 ? 'super' : tile.value}
          data-cell={tile.cell}
          data-arrived={tile.arrived}
          data-leaving={tile.leaving ? 'true' : undefined}
          style={{ ...place(tile.cell), fontSize: `${digitSize(tile.value)}cqi` }}
        >
          {tile.value}
        </div>
      ))}
    </div>
  )
}
