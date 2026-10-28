import { useFocusEntry } from '@localixai/mini-app-sdk/ui/focus'
import { useId, useRef, type CSSProperties, type PointerEvent } from 'react'

import { SIZE, type Direction, type Game } from '../../shared/game'
import { SnakeLayer } from './SnakeLayer'
import './board.css'

/**
 * The board: a flat bordered field with a hairline grid, painted by the stylesheet so the grid
 * costs no elements, and the snake and its food gliding over it (`SnakeLayer`).
 *
 * The person steers with the arrow keys or a swipe on the board while it is theirs; the first key
 * starts the snake. The grid is a size container, so it keeps its shape at any pane width.
 */

const KEYS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
}
/** A drag shorter than this is a tap, not a turn. */
const SWIPE_PX = 24

/** Inline on purpose: the host's de-duplicated sheet may drop a utility a mini app relies on. */
const BOARD: CSSProperties = {
  position: 'relative',
  aspectRatio: '1 / 1',
  touchAction: 'none',
  ['--snake-cells' as string]: SIZE,
}

/** The board in words for a screen reader: where the head and the food are. */
function boardLabel(game: Pick<Game, 'snake' | 'food'>): string {
  const at = (cell: number) => `row ${Math.floor(cell / SIZE) + 1}, column ${(cell % SIZE) + 1}`
  const food = game.food === null ? 'no food' : `food at ${at(game.food)}`
  return `Snake board. Head at ${at(game.snake[0]!)}, length ${game.snake.length}, ${food}.`
}

function useArrowKeys(
  enabled: boolean,
  onSteer: (d: Direction) => void,
  scope: () => Element | null,
) {
  const id = useId()
  useFocusEntry({
    id: `snake:${id}`,
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
      onSteer(direction)
      return true
    },
  })
}

export function Board({
  game,
  playable,
  glideMs,
  onSteer,
}: {
  game: Game
  /** The person may steer now: their board, the game on. */
  playable: boolean
  /** How long one step glides on screen. */
  glideMs: number
  onSteer: (direction: Direction) => void
}) {
  const boardRef = useRef<HTMLDivElement>(null)
  useArrowKeys(playable, onSteer, () => boardRef.current)

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
    onSteer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  return (
    <div
      ref={boardRef}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the board is a keyboard-steered application surface; it must take focus to receive the arrow keys
      tabIndex={0}
      role="application"
      aria-label={boardLabel(game)}
      data-over={game.status === 'over' ? 'true' : undefined}
      className="snake-board focus-ring"
      style={BOARD}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        swipe.current = null
      }}
    >
      <div className="snake-field">
        <SnakeLayer game={game} glideMs={glideMs} />
      </div>
    </div>
  )
}
