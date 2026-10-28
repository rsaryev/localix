import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Button } from '@localixai/kit/button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { placeName, type Game, type Mark as MarkValue } from '../../shared/game'
import { MARK_TONE, Mark } from './Mark'
import { Sparks } from './Sparks'
import { GAP, cellCentre } from './geometry'

/**
 * The board: nine tiles, the marks, and how a game ends.
 *
 * Each cell is its own TILE — a kit button with a fill — so the board has a shape even when it is
 * empty, and a mark sits in the thing it belongs to rather than between drawn lines that could
 * drift from it. The tiles are spaced by a share of the board (`gap-[3%]`), which is what lets the
 * winning line and the sparks be drawn in exact board coordinates at any size (`geometry.ts`). The
 * kit's press sink is switched off: a mark that dips under the finger reads as a mark sliding out
 * of its place.
 *
 * Every tile stays FOCUSABLE — a taken one is `aria-disabled`, not `disabled` — because the arrow
 * keys walk the grid, and a walk that skipped taken tiles would land somewhere nobody expects.
 */

/** A won line's tiles take the winner's colour, written out so the stylesheet build reads them. */
const WIN_TILE: Record<MarkValue, string> = {
  X: 'border-(--chart-2)/35 bg-(--chart-2)/12',
  O: 'border-(--chart-1)/35 bg-(--chart-1)/12',
}

/**
 * The marks that are NEW since the board last drew — the only ones animated, in the order played.
 * Opening a game in progress shows it at rest; a move made while you watch is drawn in. The result
 * is kept until the next move, so a re-render mid-animation (the clock, a poll) does not cut it off.
 */
function useArrivals(game: Game): Map<number, number> {
  const count = game.moves.length
  // State, adjusted while rendering: the first sight of a game has no arrivals.
  const [seen, setSeen] = useState<{ id: string; count: number; arrivals: Map<number, number> }>({
    id: game.id,
    count,
    arrivals: new Map(),
  })
  if (seen.id === game.id && seen.count === count) return seen.arrivals
  const since = seen.id === game.id ? seen.count : 0
  const arrivals = new Map(game.moves.slice(since).map((move, order) => [move.cell, order]))
  setSeen({ id: game.id, count, arrivals })
  return arrivals
}

/**
 * The board's geometry, INLINE on purpose. It is the one layout here that everything drawn over
 * the board depends on, and utility classes reach a mini app through the host's de-duplicated sheet
 * (`miniAppStyleDedupe`), where a rule judged a duplicate of the host's is dropped — live, the
 * tiles collapsed into one column. An inline style cannot be dropped or out-ranked.
 */
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
  gap: `${GAP}%`,
  aspectRatio: '1 / 1',
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }

export function Board({
  game,
  playable,
  onPlay,
}: {
  game: Game
  /** Whether the person may move now: their turn, and no answer is on its way. */
  playable: boolean
  onPlay: (cell: number) => void
}) {
  const arrivals = useArrivals(game)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const ended = game.status !== 'playing'
  // The end just happened in front of the person: play it. Reopened later, it is shown at rest.
  const fresh = ended && arrivals.size > 0
  const winner = game.line ? game.board[game.line[0]!] : null

  const walk = (event: KeyboardEvent, cell: number) => {
    const step = STEP[event.key]
    if (step === undefined) return
    const next = cell + step
    // Left and right stay on their row; up and down stop at the edge.
    const sameRow = Math.abs(step) !== 1 || Math.floor(next / 3) === Math.floor(cell / 3)
    if (next < 0 || next > 8 || !sameRow) return
    event.preventDefault()
    tiles.current[next]?.focus()
  }

  const markClass = (cell: number) => {
    if (!ended) return undefined
    if (game.line?.includes(cell)) return fresh ? 'tic-tac-toe-winner' : undefined
    return game.status === 'draw' ? 'tic-tac-toe-draw-mark' : 'tic-tac-toe-bystander'
  }

  return (
    <div
      role="group"
      aria-label="Board"
      className={cn(
        'relative w-full select-none',
        fresh && game.status === 'draw' && 'tic-tac-toe-settle',
      )}
      style={GRID}
    >
      {game.board.map((mark, cell) => {
        const open = mark === null && playable
        const onLine = winner !== null && game.line!.includes(cell)
        return (
          <Button
            key={cell}
            ref={(element) => {
              tiles.current[cell] = element
            }}
            variant="ghost"
            aria-label={`Cell ${cell + 1}, ${placeName(cell)}: ${mark ?? 'empty'}`}
            aria-disabled={!open}
            onClick={() => open && onPlay(cell)}
            onKeyDown={(event) => walk(event, cell)}
            className={cn(
              'tic-tac-toe-cell size-full rounded-xl border-border-faint bg-foreground/[0.035] p-[14%]',
              'active:scale-100 active:not-aria-[haspopup]:translate-y-0',
              open
                ? 'hover:border-border-soft hover:bg-surface-hover'
                : 'cursor-default hover:bg-foreground/[0.035]',
              onLine && WIN_TILE[winner],
              onLine && 'transition-colors duration-(--dur-slow)',
            )}
          >
            {mark ? (
              <Mark
                mark={mark}
                drawn={arrivals.has(cell)}
                order={arrivals.get(cell)}
                className={markClass(cell)}
                style={
                  onLine
                    ? ({ '--tic-tac-toe-order': game.line!.indexOf(cell) } as CSSProperties)
                    : undefined
                }
              />
            ) : (
              open && <Mark mark="X" className="tic-tac-toe-preview" />
            )}
          </Button>
        )
      })}
      {game.line && winner && (
        <svg
          viewBox="0 0 100 100"
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 size-full', MARK_TONE[winner])}
        >
          <line
            {...winLine(game.line)}
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            pathLength={100}
            opacity={0.9}
            className={fresh ? 'tic-tac-toe-win-line' : undefined}
          />
        </svg>
      )}
      {fresh && game.status === 'won' && game.line && <Sparks around={game.line[1]!} />}
    </div>
  )
}

/** The winning line, run a little past the centres of its end tiles. */
function winLine(line: readonly number[]) {
  const a = cellCentre(line[0]!)
  const c = cellCentre(line[2]!)
  const length = Math.hypot(c.x - a.x, c.y - a.y)
  const [dx, dy] = [((c.x - a.x) / length) * 9, ((c.y - a.y) / length) * 9]
  return { x1: a.x - dx, y1: a.y - dy, x2: c.x + dx, y2: c.y + dy }
}
