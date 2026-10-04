import { colOf, rowOf, type Play } from './rules'

/**
 * Moves in the notation players already read: squares as "c3", a step as "c3-d4", a capture as
 * "c3:e5:g3" through every square it lands on. The agent writes its move this way and reads the
 * legal ones this way, so the one parser here is the only place a typed move becomes a {@link Play}.
 */

const FILES = 'abcdefgh'

/** "c3" — file from the left of White's side, rank from White's edge. */
export const squareName = (square: number): string => `${FILES[colOf(square)]}${8 - rowOf(square)}`

/** The square a name like "c3" stands for, or null. */
export function squareAt(name: string): number | null {
  const match = /^([a-h])([1-8])$/.exec(name.trim().toLowerCase())
  if (!match) return null
  return (8 - Number(match[2])) * 8 + FILES.indexOf(match[1]!)
}

/** "c3-d4" or "c3:e5:g3". */
export const moveName = (play: Pick<Play, 'from' | 'path' | 'captured'>): string =>
  [play.from, ...play.path].map(squareName).join(play.captured.length > 0 ? ':' : '-')

/** The squares a move visits, start first — what the view sends and what a typed move names. */
export const squaresOf = (play: Pick<Play, 'from' | 'path'>) => [play.from, ...play.path]

/**
 * The legal move `squares` names: every square it visits, or — when only the start and the end are
 * given — the one legal move between them. Null when it names none, or more than one.
 */
export function findPlay(legal: readonly Play[], squares: readonly number[]): Play | null {
  if (squares.length < 2) return null
  const exact = legal.find((play) => {
    const visits = squaresOf(play)
    return visits.length === squares.length && visits.every((square, i) => square === squares[i])
  })
  if (exact) return exact
  if (squares.length !== 2) return null
  const ends = legal.filter((play) => play.from === squares[0] && play.path.at(-1) === squares[1])
  return ends.length === 1 ? ends[0]! : null
}

/** Every square named in `text` ("c3-d4", "c3 x e5", "C3:E5"), in order. */
export const parseSquares = (text: string): number[] =>
  (text.toLowerCase().match(/[a-h][1-8]/g) ?? []).map((name) => squareAt(name)!)
