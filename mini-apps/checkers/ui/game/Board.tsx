import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { movesNow, type Game, type Move } from '../../shared/game'
import { squareName } from '../../shared/notation'
import { isDark, other } from '../../shared/rules'
import { click, movablePieces, nextSquares } from './selection'
import { Piece } from './Piece'
import { Sparks } from './Sparks'
import './board.css'

/**
 * The board: sixty-four squares, the pieces, and the move being built.
 *
 * It is drawn from the PERSON's side — their pieces at the bottom whichever colour they play — so
 * "forward" always points up the screen. Clicks build a move through `selection.ts`, which asks the
 * rules at every step; the board only shows what those answers mean: the pieces that may move,
 * where the picked one can land next, and — when a capture is compulsory — which pieces must take.
 *
 * Every square is a FOCUSABLE button, light ones included (`aria-disabled`), because the arrow keys
 * walk the grid, and a walk that skipped squares would land somewhere nobody expects.
 */

/** The squares in reading order on screen: from White's side as stored, or turned for Black. */
const displayOrder = (flip: boolean) =>
  Array.from({ length: 64 }, (_, index) => (flip ? 63 - index : index))

/**
 * The moves that are NEW since the board last drew — the only ones animated, in the order played.
 * Opening a game in progress shows it at rest; a move made while you watch lands in front of you.
 * The result is kept until the next move, so a re-render mid-animation does not cut it off.
 */
function useArrivals(game: Game): Move[] {
  const memo = useRef<{ id: string; count: number; arrivals: Move[] } | null>(null)
  const seen = memo.current
  const count = game.moves.length
  if (!seen || seen.id !== game.id || seen.count !== count) {
    const since = !seen ? count : seen.id === game.id ? seen.count : count
    memo.current = { id: game.id, count, arrivals: game.moves.slice(since) }
  }
  return memo.current!.arrivals
}

/**
 * The grid, INLINE on purpose: it is the one layout everything here depends on, and a utility
 * class reaching a mini app through the host's de-duplicated sheet can be dropped — live, a grid
 * collapsed into one column. An inline style cannot be dropped or out-ranked.
 */
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
  aspectRatio: '1 / 1',
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }

export function Board({
  game,
  playable,
  onPlay,
}: {
  game: Game
  /** Whether the person may move now: their turn, and no answer is on its way. */
  playable: boolean
  onPlay: (squares: number[]) => void
}) {
  const flip = game.you === 'black'
  const order = displayOrder(flip)
  const legal = playable ? movesNow(game) : []
  const [picked, setPicked] = useState<number[]>([])
  const arrivals = useArrivals(game)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // A new position ends whatever move was being built on the old one.
  useEffect(() => setPicked([]), [game.id, game.moves.length, playable])

  const targets = nextSquares(legal, picked)
  const movable = movablePieces(legal)
  const mustCapture = legal[0]?.captured.length ? movable : new Set<number>()
  const last = game.moves.at(-1)
  const trail = new Set(last ? [last.from, ...last.path] : [])
  const fresh = game.status !== 'playing' && arrivals.length > 0

  const choose = (square: number) => {
    const next = click(legal, picked, square)
    setPicked(next.picked)
    if (next.send) onPlay(next.send)
  }

  const walk = (event: KeyboardEvent, index: number) => {
    if (event.key === 'Escape') return setPicked([])
    const step = STEP[event.key]
    if (step === undefined) return
    const next = index + step
    // Left and right stay on their row; up and down stop at the edge.
    const sameRow = Math.abs(step) !== 1 || Math.floor(next / 8) === Math.floor(index / 8)
    if (next < 0 || next > 63 || !sameRow) return
    event.preventDefault()
    buttons.current[next]?.focus()
  }

  return (
    // The burst sits outside the board's clipping edge, so it can fly past it.
    <div className="relative w-full">
      <div
        role="group"
        aria-label="Board"
        className="checkers-board w-full select-none"
        style={GRID}
      >
        {order.map((square, index) => {
          const piece = game.board[square]
          const target = picked.length > 0 && targets.has(square)
          const action = target || movable.has(square)
          const arrival = arrivals.findIndex((move) => move.path.at(-1) === square)
          const taken = arrivals.findIndex((move) => move.captured.includes(square))
          return (
            <button
              key={square}
              type="button"
              ref={(element) => {
                buttons.current[index] = element
              }}
              aria-label={label(square, game)}
              aria-disabled={!action}
              aria-pressed={picked.includes(square) || undefined}
              data-dark={isDark(square)}
              data-trail={trail.has(square)}
              data-selected={picked.includes(square)}
              data-action={action}
              data-must={picked.length === 0 && mustCapture.has(square)}
              className="checkers-square"
              onClick={() => action && choose(square)}
              onKeyDown={(event) => walk(event, index)}
            >
              {piece && (
                <Piece
                  side={piece.side}
                  king={piece.king}
                  className={arrival >= 0 && game.board[square] ? 'checkers-arrive' : undefined}
                  style={arrival >= 0 ? delay(arrival) : undefined}
                />
              )}
              {!piece && taken >= 0 && (
                <Piece
                  side={other(arrivals[taken]!.side)}
                  king={false}
                  className="checkers-taken"
                  style={delay(taken)}
                />
              )}
              {target && !piece && <span className="checkers-target" />}
            </button>
          )
        })}
      </div>
      {fresh && game.status === 'won' && <Sparks />}
    </div>
  )
}

const delay = (order: number) =>
  ({ '--checkers-delay': `calc(var(--dur-moderate) * ${order})` }) as CSSProperties

/** "Square c3: white man" — what a screen reader hears on each square. */
function label(square: number, game: Game): string {
  if (!isDark(square)) return `Square ${squareName(square)}: light`
  const piece = game.board[square]
  const what = piece ? `${piece.side} ${piece.king ? 'king' : 'man'}` : 'empty'
  return `Square ${squareName(square)}: ${what}`
}
