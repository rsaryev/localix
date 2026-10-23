import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { positionOfGame, type Game, type Move } from '../../shared/game'
import type { Promotion, Square } from '../../shared/position'
import { PromotionChoice } from './PromotionChoice'
import { Piece } from './Piece'
import { click, movable, promote, targetsOf } from './selection'
import { Sparks } from './Sparks'
import './board.css'

/**
 * The board: sixty-four squares, the pieces, and the move being built.
 *
 * It is drawn from the PERSON's side — their pieces at the bottom whichever colour they play.
 * Clicks build a move through `selection.ts`, which asks the rules at every step; the board only
 * shows what those answers mean: the pieces that may move, where the picked one can go (a dot, or
 * a ring around a piece it would take), the king in check, and the last move's squares.
 *
 * Every square is a FOCUSABLE button (`aria-disabled` when it takes no click), because the arrow
 * keys walk the grid, and a walk that skipped squares would land somewhere nobody expects.
 */

const FILES = 'abcdefgh'
const squareAt = (index: number, flip: boolean): Square => {
  const at = flip ? 63 - index : index
  return `${FILES[at % 8]}${8 - Math.floor(at / 8)}` as Square
}

/**
 * The moves that are NEW since the board last drew — the only ones animated. Opening a game in
 * progress shows it at rest; a move made while the person watches lands in front of them.
 */
function useArrivals(game: Game): Move[] {
  const memo = useRef<{ id: string; count: number; arrivals: Move[] } | null>(null)
  const seen = memo.current
  const count = game.moves.length
  if (!seen || seen.id !== game.id || seen.count !== count) {
    const since = !seen || seen.id !== game.id ? count : seen.count
    memo.current = { id: game.id, count, arrivals: game.moves.slice(since) }
  }
  return memo.current!.arrivals
}

/**
 * The grid, INLINE on purpose: it is the one layout everything here depends on, and a utility
 * class reaching a plugin through the host's de-duplicated sheet can be dropped.
 */
const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
  gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
  aspectRatio: '1 / 1',
  containerType: 'inline-size',
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
  onPlay: (move: string) => void
}) {
  const flip = game.you === 'black'
  const position = positionOfGame(game)
  const legal = playable ? position.legal : []
  const [picked, setPicked] = useState<Square | null>(null)
  const [promoting, setPromoting] = useState<{ from: Square; to: Square } | null>(null)
  const arrivals = useArrivals(game)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // A new position ends whatever move was being built on the old one.
  useEffect(() => {
    setPicked(null)
    setPromoting(null)
  }, [game.id, game.moves.length, playable])

  const pieces = new Map(position.cells.map((cell) => [cell.square, cell.piece]))
  const targets = targetsOf(legal, picked)
  const canMove = movable(legal)
  const last = game.moves.at(-1)
  const checked =
    position.inCheck &&
    position.cells.find((c) => c.piece?.type === 'k' && c.piece.side === position.turn)?.square
  const fresh = game.status !== 'playing' && arrivals.length > 0

  const choose = (square: Square) => {
    const next = click(legal, picked, square)
    if (next.kind === 'pick') setPicked(next.square)
    else if (next.kind === 'drop') setPicked(null)
    else if (next.kind === 'promote') setPromoting({ from: next.from, to: next.to })
    else {
      setPicked(null)
      onPlay(next.move)
    }
  }

  const walk = (event: KeyboardEvent, index: number) => {
    if (event.key === 'Escape') {
      setPicked(null)
      setPromoting(null)
      return
    }
    const step = STEP[event.key]
    if (step === undefined) return
    const next = index + step
    const sameRow = Math.abs(step) !== 1 || Math.floor(next / 8) === Math.floor(index / 8)
    if (next < 0 || next > 63 || !sameRow) return
    event.preventDefault()
    buttons.current[next]?.focus()
  }

  return (
    // The burst sits outside the board's clipping edge, so it can fly past it.
    <div className="relative w-full">
      <div role="group" aria-label="Board" className="chess-board w-full select-none" style={GRID}>
        {Array.from({ length: 64 }, (_, index) => {
          const square = squareAt(index, flip)
          const piece = pieces.get(square) ?? null
          const target = targets.has(square)
          const action = target || canMove.has(square)
          const arrived = arrivals.findIndex((move) => move.to === square)
          const dark = (Math.floor(index / 8) + index) % 2 === 1
          return (
            <button
              key={square}
              type="button"
              ref={(element) => {
                buttons.current[index] = element
              }}
              aria-label={`${square}: ${piece ? `${piece.side} ${NAME[piece.type]}` : 'empty'}`}
              aria-disabled={!action}
              aria-pressed={picked === square || undefined}
              data-dark={dark}
              data-trail={last !== undefined && (last.from === square || last.to === square)}
              data-selected={picked === square}
              data-check={checked === square}
              data-action={action}
              className="chess-square"
              onClick={() => action && choose(square)}
              onKeyDown={(event) => walk(event, index)}
            >
              {piece && (
                <Piece
                  side={piece.side}
                  type={piece.type}
                  className={arrived >= 0 ? 'chess-arrive' : undefined}
                />
              )}
              {target && <span className="chess-target" data-capture={piece !== null} />}
              {index % 8 === 0 && <span className="chess-rank">{square[1]}</span>}
              {index >= 56 && <span className="chess-file">{square[0]}</span>}
            </button>
          )
        })}
      </div>
      {promoting && (
        <PromotionChoice
          side={game.you}
          onChoose={(piece: Promotion) => {
            setPromoting(null)
            setPicked(null)
            onPlay(promote(promoting.from, promoting.to, piece))
          }}
          onCancel={() => setPromoting(null)}
        />
      )}
      {fresh && game.status === 'won' && <Sparks />}
    </div>
  )
}

const NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}
