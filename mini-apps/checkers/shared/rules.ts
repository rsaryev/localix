/**
 * The rules of Russian draughts, as pure functions of a board: which moves a side has, and the board
 * after one. Every caller — the routes, the tools and the view's highlights — asks here,
 * so none of them can disagree about whether a move is legal.
 *
 * The rules that decide a move, each of which a simpler reading gets wrong:
 *
 * - A capture is COMPULSORY, and a capture that can go on must go on. Among several captures the
 *   player may choose any, not only the longest.
 * - A man moves forward one square but captures in all four directions.
 * - A king FLIES: it moves any distance along a free diagonal, and captures a piece at any distance,
 *   landing on any free square beyond it — but when some of those landings let the capture go on,
 *   it must take one of those.
 * - A man that reaches the far row mid-capture is crowned at once and goes on capturing as a king.
 * - Captured pieces stay on the board until the move ends: a piece is never jumped twice, and a
 *   piece already jumped blocks the way (no "Turkish strike").
 *
 * Squares are indexed 0–63 row by row from a8 (row 0 is rank 8, column 0 is file a); play happens
 * on the dark squares only, where row + column is odd. White starts on ranks 1–3 and moves up.
 */

export const SIDES = ['white', 'black'] as const
export type Side = (typeof SIDES)[number]

export interface Piece {
  side: Side
  king: boolean
}
export type Square = Piece | null

/** One legal move: where the piece starts, every square it lands on, and what it takes. */
export interface Play {
  from: number
  path: number[]
  captured: number[]
  crowned: boolean
}

export const rowOf = (square: number) => Math.floor(square / 8)
export const colOf = (square: number) => square % 8
export const isDark = (square: number) => (rowOf(square) + colOf(square)) % 2 === 1
export const other = (side: Side): Side => (side === 'white' ? 'black' : 'white')

const at = (row: number, col: number): number | null =>
  row < 0 || row > 7 || col < 0 || col > 7 ? null : row * 8 + col

/** The row a side's men step toward, and the row that crowns them. */
const forward = (side: Side) => (side === 'white' ? -1 : 1)
const crownRow = (side: Side) => (side === 'white' ? 0 : 7)

const DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const

/** The opening position: twelve men each on the three rows nearest their side. */
export function openingBoard(): Square[] {
  return Array.from({ length: 64 }, (_, square) => {
    if (!isDark(square)) return null
    if (rowOf(square) <= 2) return { side: 'black', king: false }
    if (rowOf(square) >= 5) return { side: 'white', king: false }
    return null
  })
}

interface Jump {
  over: number
  landings: number[]
}

/**
 * The single jumps a piece of `side` standing on `square` can make. The mover's own starting square
 * reads as empty — it has left it — and pieces already `captured` in this move block but cannot be
 * taken again.
 */
function jumpsFrom(
  board: readonly Square[],
  side: Side,
  origin: number,
  square: number,
  king: boolean,
  captured: readonly number[],
): Jump[] {
  const occupant = (index: number) => (index === origin ? null : board[index])
  const jumps: Jump[] = []
  for (const [dr, dc] of DIRECTIONS) {
    let row = rowOf(square) + dr
    let col = colOf(square) + dc
    // A king slides up to the first piece in this direction; a man looks at the next square only.
    while (king && at(row, col) !== null && occupant(at(row, col)!) === null) {
      row += dr
      col += dc
    }
    const over = at(row, col)
    if (over === null) continue
    const victim = occupant(over)
    if (!victim || victim.side === side || captured.includes(over)) continue
    const landings: number[] = []
    for (let next = at(row + dr, col + dc), step = 2; next !== null; step++) {
      if (occupant(next) !== null) break
      landings.push(next)
      if (!king) break
      next = at(row + dr * step, col + dc * step)
    }
    if (landings.length > 0) jumps.push({ over, landings })
  }
  return jumps
}

/** Every complete capture from `from`: each one runs until no further jump is possible. */
function capturesFrom(board: readonly Square[], from: number): Play[] {
  const piece = board[from]!
  const plays: Play[] = []
  const walk = (square: number, king: boolean, path: number[], captured: number[]) => {
    let extended = false
    for (const { over, landings } of jumpsFrom(board, piece.side, from, square, king, captured)) {
      const taken = [...captured, over]
      const options = landings.map((landing) => ({
        landing,
        king: king || rowOf(landing) === crownRow(piece.side),
      }))
      // A king that can land where the capture goes on must land there.
      const onward = options.filter(
        (option) =>
          jumpsFrom(board, piece.side, from, option.landing, option.king, taken).length > 0,
      )
      for (const option of onward.length > 0 ? onward : options) {
        extended = true
        walk(option.landing, option.king, [...path, option.landing], taken)
      }
    }
    if (!extended && path.length > 0)
      plays.push({ from, path, captured, crowned: king && !piece.king })
  }
  walk(from, piece.king, [], [])
  return plays
}

/** The non-capturing moves from `from`: a man one step forward, a king any free distance. */
function stepsFrom(board: readonly Square[], from: number): Play[] {
  const piece = board[from]!
  const plays: Play[] = []
  for (const [dr, dc] of DIRECTIONS) {
    if (!piece.king && dr !== forward(piece.side)) continue
    for (let step = 1; ; step++) {
      const to = at(rowOf(from) + dr * step, colOf(from) + dc * step)
      if (to === null || board[to] !== null) break
      const crowned = !piece.king && rowOf(to) === crownRow(piece.side)
      plays.push({ from, path: [to], captured: [], crowned })
      if (!piece.king) break
    }
  }
  return plays
}

/** The squares holding `side`'s pieces, in board order. */
const squaresOf = (board: readonly Square[], side: Side) =>
  board.flatMap((piece, square) => (piece?.side === side ? [square] : []))

/** Every legal move for `side`: its captures when it has any, else its steps. */
export function legalMoves(board: readonly Square[], side: Side): Play[] {
  const squares = squaresOf(board, side)
  const captures = squares.flatMap((square) => capturesFrom(board, square))
  return captures.length > 0 ? captures : squares.flatMap((square) => stepsFrom(board, square))
}

/** The board after `play`: the piece moved (and crowned), the pieces it took removed. */
export function applyPlay(board: readonly Square[], play: Play): Square[] {
  const piece = board[play.from]!
  const next = [...board]
  next[play.from] = null
  for (const square of play.captured) next[square] = null
  next[play.path.at(-1)!] = { side: piece.side, king: piece.king || play.crowned }
  return next
}

export const countPieces = (board: readonly Square[], side: Side) =>
  board.filter((piece) => piece?.side === side).length
