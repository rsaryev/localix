import { useEffect, useRef, useState } from 'react'

import type { Game, Step } from '../../shared/game'
import { restingTiles, stepTiles, type Tile, type Tiles } from './tiles'

/** How long one replayed move takes — a slide, then the next. */
export const STEP_MS = 110
/** A view this far behind the board skips to it rather than replaying a minute of moves. */
const MAX_BEHIND = 64

const sameBoard = (a: readonly number[], b: readonly number[]) =>
  a.every((value, cell) => value === b[cell])

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The tiles to draw for `game`, REPLAYED one move at a time.
 *
 * The agent's moves land as one write of up to 32 moves, and the view learns of them by polling,
 * so without a replay it saw the board jump thirty moves at once. The game carries its last turn
 * (`lastTurn`: the board it started from and each move with its spawn); when that turn follows the
 * board this view last drew, its moves are queued and played at {@link STEP_MS} each, and a turn
 * that arrives while the queue plays joins it. Anything else — a first look, a new game, a view
 * that missed a turn, reduced motion — shows the board at rest, because a replay from a board the
 * view never drew would slide tiles from the wrong cells.
 */
export function useTiles(game: Game): Tile[] {
  const [tiles, setTiles] = useState<Tiles>(() => restingTiles(game.board))
  const [pending, setPending] = useState(0)
  // Where the queue ENDS, so the next turn can be checked against it.
  const plan = useRef({ id: game.id, moves: game.moves, board: game.board, queue: [] as Step[] })
  const lastStepAt = useRef(0)

  useEffect(() => {
    const current = plan.current
    if (current.id === game.id && current.moves === game.moves) return
    const turn = game.lastTurn
    const follows =
      turn !== null &&
      current.id === game.id &&
      game.moves - turn.steps.length === current.moves &&
      sameBoard(turn.from, current.board) &&
      current.queue.length + turn.steps.length <= MAX_BEHIND &&
      !prefersReducedMotion()
    if (follows) current.queue.push(...turn.steps)
    else {
      current.queue = []
      const newGame = current.id !== game.id
      setTiles((drawn) => restingTiles(game.board, drawn.nextId, newGame ? 'spawn' : undefined))
    }
    plan.current = { ...current, id: game.id, moves: game.moves, board: game.board }
    setPending(current.queue.length)
  }, [game])

  useEffect(() => {
    if (pending === 0) return
    const wait = Math.max(0, lastStepAt.current + STEP_MS - Date.now())
    const timer = setTimeout(() => {
      const step = plan.current.queue.shift()
      lastStepAt.current = Date.now()
      if (step) setTiles((drawn) => stepTiles(drawn, step))
      setPending(plan.current.queue.length)
    }, wait)
    return () => clearTimeout(timer)
  }, [pending, tiles])

  return tiles.tiles
}
