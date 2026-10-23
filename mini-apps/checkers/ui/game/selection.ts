import { squaresOf } from '../../shared/notation'
import type { Play } from '../../shared/rules'

/**
 * How clicks become a move. A draughts move can visit many squares, so the person builds it one
 * click at a time: the piece, then each square it lands on, until exactly one legal move is spelled
 * out — and that one is sent. `picked` is the squares chosen so far, start first.
 *
 * The view never judges legality itself: every click is checked against the rules' own list, so
 * a square is clickable exactly when some legal move goes there next. That is what makes the
 * compulsory capture visible rather than a refusal after the fact — a piece that may not move
 * simply takes no click.
 */

const startsWith = (play: Play, picked: readonly number[]) => {
  const visits = squaresOf(play)
  return picked.every((square, index) => visits[index] === square)
}

/** The legal moves that begin with the squares picked so far. */
export const candidates = (legal: readonly Play[], picked: readonly number[]) =>
  legal.filter((play) => startsWith(play, picked))

/** The squares a click may go to next: a piece to pick up, or where the picked one lands next. */
export function nextSquares(legal: readonly Play[], picked: readonly number[]): Set<number> {
  return new Set(candidates(legal, picked).map((play) => squaresOf(play)[picked.length]!))
}

/** The pieces that can move at all. */
export const movablePieces = (legal: readonly Play[]) => new Set(legal.map((play) => play.from))

/**
 * A click on `square`: the squares picked after it, and the move to send when the click completed
 * one. Clicking the picked piece again drops it; clicking another movable piece picks that one.
 */
export function click(
  legal: readonly Play[],
  picked: readonly number[],
  square: number,
): { picked: number[]; send: number[] | null } {
  if (picked.length > 0 && nextSquares(legal, picked).has(square)) {
    const next = [...picked, square]
    const complete = candidates(legal, next).find((play) => squaresOf(play).length === next.length)
    return complete ? { picked: [], send: next } : { picked: next, send: null }
  }
  if (picked.length === 1 && picked[0] === square) return { picked: [], send: null }
  if (movablePieces(legal).has(square)) return { picked: [square], send: null }
  return { picked: [], send: null }
}
