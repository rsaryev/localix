import type { Play, Promotion, Square } from '../../shared/position'

/**
 * How clicks become a move: the piece, then the square it goes to. The view never judges legality
 * itself — every click is checked against the rules' own list, so a square takes a click exactly
 * when some legal move goes there, and a pinned piece simply takes none.
 *
 * A pawn reaching the last rank is four legal moves on one square (queen, rook, bishop, knight),
 * so that click does not send: it asks which piece, and `promote` sends the choice.
 */

/** The squares a piece can be picked up from. */
export const movable = (legal: readonly Play[]) => new Set(legal.map((play) => play.from))

/** Where the picked piece can go. */
export const targetsOf = (legal: readonly Play[], picked: Square | null) =>
  new Set(picked ? legal.filter((play) => play.from === picked).map((play) => play.to) : [])

export type Click =
  | { kind: 'pick'; square: Square }
  | { kind: 'drop' }
  | { kind: 'send'; move: string }
  | { kind: 'promote'; from: Square; to: Square }

/** A click on `square` while `picked` is held. */
export function click(legal: readonly Play[], picked: Square | null, square: Square): Click {
  if (picked) {
    const onto = legal.filter((play) => play.from === picked && play.to === square)
    if (onto.length > 1) return { kind: 'promote', from: picked, to: square }
    if (onto.length === 1) return { kind: 'send', move: `${picked}${square}` }
    if (picked === square) return { kind: 'drop' }
  }
  return movable(legal).has(square) ? { kind: 'pick', square } : { kind: 'drop' }
}

/** The move for a promotion the person chose: coordinates with the piece, "e7e8n". */
export const promote = (from: Square, to: Square, piece: Promotion) => `${from}${to}${piece}`
