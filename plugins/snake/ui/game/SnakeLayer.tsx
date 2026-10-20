import { SIZE, type Game } from '../../shared/game'
import { centre, useGlide } from './useGlide'

/**
 * The snake and its food, drawn as one SVG in cell units (`viewBox` 0–16) over the hairline grid.
 *
 * Schematic on purpose, like the other boards: the body is ONE flat polyline of uniform width
 * through the glided segment centres (`useGlide`), with round joins so it bends cleanly as the
 * head eases into a cell and the tail eases out of one; the head is a rounded square in the
 * body's colour at full strength; the food is a small square in the second chart series. Only SVG
 * attributes change per frame — nothing that moves layout — and the food's fade-in is skipped for
 * a person who asked for reduced motion (`board.css`).
 */

/** The body's width, and the head's and the food's sides, in cells. */
const BODY_WIDTH = 0.62
const HEAD_SIDE = 0.74
const FOOD_SIDE = 0.4

export function SnakeLayer({
  game,
  glideMs,
}: {
  game: Pick<Game, 'snake' | 'food' | 'status'>
  /** How long one step glides: a tick for the person's snake, the model's pace for its steps. */
  glideMs: number
}) {
  const points = useGlide(game.snake, SIZE, glideMs)
  const head = points[0]!
  const food = game.food === null ? null : centre(game.food, SIZE)
  return (
    <svg
      className="snake-layer"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      aria-hidden
      data-head={game.snake[0]}
      data-over={game.status === 'over' ? 'true' : undefined}
    >
      {food && (
        <rect
          key={game.food}
          className="snake-food"
          x={food.x - FOOD_SIDE / 2}
          y={food.y - FOOD_SIDE / 2}
          width={FOOD_SIDE}
          height={FOOD_SIDE}
          rx={0.08}
        />
      )}
      {points.length > 1 && (
        <polyline
          className="snake-body"
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          strokeWidth={BODY_WIDTH}
        />
      )}
      <rect
        className="snake-head"
        x={head.x - HEAD_SIDE / 2}
        y={head.y - HEAD_SIDE / 2}
        width={HEAD_SIDE}
        height={HEAD_SIDE}
        rx={0.2}
      />
    </svg>
  )
}
