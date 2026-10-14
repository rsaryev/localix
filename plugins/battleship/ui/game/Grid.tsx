import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { SIZE, cellName, colOf, rowOf } from '../../shared/rules'
import type { CellState } from './cells'
import type { Arrival } from './Effects'
import { LABEL } from './layout'
import './board.css'

/**
 * One 10×10 board in the games' shared style — the Tic-Tac-Toe look at a hundred cells: each cell
 * its own TILE, a miss a small dot, a hit a cross drawn in stroke by stroke, a ship a filled tile.
 * A mark that arrives while the person watches is drawn in with a soft ripple, like a new X or O.
 *
 * The enemy board passes `onFire`: every tile is then a FOCUSABLE button — one that cannot be fired
 * at is `aria-disabled`, not `disabled` — because the arrow keys walk the grid, and a walk that
 * skipped tiles would land somewhere nobody expects. The person's own board takes no input.
 */

const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const
const STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -SIZE,
  ArrowDown: SIZE,
}

export function Grid({
  label,
  cells,
  fired,
  last,
  arrivals,
  cell,
  active,
  onFire,
  playable = false,
}: {
  label: string
  cells: CellState[]
  /** The cells shot at on this board — a miss shows a dot where inferred water does not. */
  fired: ReadonlySet<number>
  /** The cell of the last shot on this board, outlined. */
  last: number | null
  /** Shots landing on this board right now: their marks are drawn in. */
  arrivals: readonly Arrival[]
  /** The cell pitch in pixels, from the pane's measured space (`layout.ts`). */
  cell: number
  /** Whether this board is where the action is: the target on the person's turn, their fleet on the agent's. */
  active: boolean
  onFire?: (cell: number) => void
  playable?: boolean
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const walk = (event: KeyboardEvent, at: number) => {
    const step = STEP[event.key]
    if (step === undefined) return
    const next = at + step
    const sameRow = Math.abs(step) !== 1 || Math.floor(next / SIZE) === Math.floor(at / SIZE)
    if (next < 0 || next >= SIZE * SIZE || !sameRow) return
    event.preventDefault()
    buttons.current[next]?.focus()
  }

  // The tracks, INLINE: utility classes reach a plugin through the host's de-duplicated sheet,
  // where a rule can be dropped — live, a board's tiles once collapsed into one column.
  const gap = Math.max(2, Math.round(cell * 0.08))
  const tile = cell - gap
  const tracks: CSSProperties = {
    gridTemplateColumns: `${LABEL}px repeat(${SIZE}, ${tile}px)`,
    gridTemplateRows: `${LABEL}px repeat(${SIZE}, ${tile}px)`,
    gap: `${gap}px`,
  }
  const arrived = new Map(arrivals.map(({ shot, order }) => [shot.cell, order]))

  return (
    <div
      role="group"
      aria-label={label}
      className={cn('bs-board', active && 'bs-board-active')}
      style={tracks}
    >
      {COLUMNS.map((column, col) => (
        <span
          key={column}
          aria-hidden="true"
          className="bs-label"
          style={{ gridRow: 1, gridColumn: col + 2 }}
        >
          {column}
        </span>
      ))}
      {Array.from({ length: SIZE }, (_, row) => (
        <span
          key={`row-${row}`}
          aria-hidden="true"
          className="bs-label"
          style={{ gridRow: row + 2, gridColumn: 1 }}
        >
          {row + 1}
        </span>
      ))}

      {cells.map((state, at) => {
        const area = { gridRow: rowOf(at) + 2, gridColumn: colOf(at) + 2 }
        const tileProps = {
          'data-state': state,
          'data-last': last === at,
          className: 'bs-tile',
          style: area,
        }
        const mark = <Mark state={state} fired={fired.has(at)} order={arrived.get(at)} />
        const name = `${cellName(at)}: ${state}`
        if (!onFire)
          return (
            <span key={at} role="img" aria-label={name} {...tileProps}>
              {mark}
            </span>
          )
        const open = playable && state === 'unknown'
        return (
          <button
            key={at}
            type="button"
            ref={(element) => {
              buttons.current[at] = element
            }}
            aria-label={name}
            aria-disabled={!open}
            data-action={open}
            {...tileProps}
            onClick={() => open && onFire(at)}
            onKeyDown={(event) => walk(event, at)}
          >
            {mark}
          </button>
        )
      })}
    </div>
  )
}

/**
 * What a tile shows: a cross for a hit (drawn in when it just arrived), a dot for a miss. `order`
 * is set only for a mark that just arrived — its place among the shots that arrived together.
 */
function Mark({ state, fired, order }: { state: CellState; fired: boolean; order?: number }) {
  const hit = state === 'hit' || state === 'sunk'
  if (!hit && !(fired && state === 'water')) return null
  const drawn = order !== undefined
  const style = drawn
    ? ({ '--bs-delay': `calc(var(--dur-moderate) * ${order})` } as CSSProperties)
    : undefined
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className="bs-mark" data-hit={hit} style={style}>
      {drawn && <circle cx="50" cy="50" r="34" className="bs-ripple" />}
      {hit ? (
        <>
          <line
            x1="30"
            y1="30"
            x2="70"
            y2="70"
            pathLength={100}
            className={cn(drawn && 'bs-stroke')}
          />
          <line
            x1="70"
            y1="30"
            x2="30"
            y2="70"
            pathLength={100}
            className={cn(drawn && 'bs-stroke bs-stroke-second')}
          />
        </>
      ) : (
        <circle cx="50" cy="50" r="9" className={cn('bs-dot', drawn && 'bs-dot-in')} />
      )}
    </svg>
  )
}
