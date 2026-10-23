import { Chess, type Move as EngineMove, type Square } from 'chess.js'

/**
 * THE ONE DOOR TO THE RULES. Chess is too large a rule set to write again — castling rights, en
 * passant, promotion, pins, stalemate, threefold repetition, the fifty-move rule, insufficient
 * material — so the mini app uses `chess.js` (BSD-2-Clause), a mature, tested implementation, and
 * nothing outside this file names it. Every other module asks here, in the mini app's own terms.
 *
 * A position is REPLAYED from the moves played, never trusted from a stored FEN: the history is
 * what threefold repetition is decided on, so a position without it would be a different game.
 */

export const SIDES = ['white', 'black'] as const
export type Side = (typeof SIDES)[number]
export const other = (side: Side): Side => (side === 'white' ? 'black' : 'white')

export type { Square }
export const PROMOTIONS = ['q', 'r', 'b', 'n'] as const
export type Promotion = (typeof PROMOTIONS)[number]

/** A legal move, in the mini app's terms. */
export interface Play {
  san: string
  from: Square
  to: Square
  promotion?: Promotion
  captured?: string
  side: Side
}

/** How a finished game ended; null while it goes on. */
export type Ending = 'checkmate' | 'stalemate' | 'threefold' | 'insufficient' | 'fifty-move'

const sideOf = (color: 'w' | 'b'): Side => (color === 'w' ? 'white' : 'black')

const toPlay = (move: EngineMove): Play => ({
  san: move.san,
  from: move.from,
  to: move.to,
  ...(move.promotion ? { promotion: move.promotion as Promotion } : {}),
  ...(move.captured ? { captured: move.captured } : {}),
  side: sideOf(move.color),
})

/** The position after `sans`, played from the start. Throws if one of them is not legal there. */
function replay(sans: readonly string[]): Chess {
  const chess = new Chess()
  for (const san of sans) chess.move(san)
  return chess
}

/** One square on the board, as the view draws it. */
export interface Cell {
  square: Square
  piece: { side: Side; type: string } | null
}

export interface Position {
  turn: Side
  legal: Play[]
  inCheck: boolean
  ending: Ending | null
  /** The board row by row from rank 8, file a first — as FEN reads it. */
  cells: Cell[]
  fen: string
}

export function positionOf(sans: readonly string[]): Position {
  const chess = replay(sans)
  const ending: Ending | null = chess.isCheckmate()
    ? 'checkmate'
    : chess.isStalemate()
      ? 'stalemate'
      : chess.isThreefoldRepetition()
        ? 'threefold'
        : chess.isInsufficientMaterial()
          ? 'insufficient'
          : chess.isDrawByFiftyMoves()
            ? 'fifty-move'
            : null
  return {
    turn: sideOf(chess.turn()),
    legal: chess.moves({ verbose: true }).map(toPlay),
    inCheck: chess.inCheck(),
    ending,
    cells: chess.board().flatMap((row, r) =>
      row.map((piece, c) => ({
        square: `${'abcdefgh'[c]}${8 - r}` as Square,
        piece: piece ? { side: sideOf(piece.color), type: piece.type } : null,
      })),
    ),
    fen: chess.fen(),
  }
}

/**
 * The legal move `text` names, in either notation a player writes: SAN ("Nf3", "exd5", "O-O",
 * "e8=Q") or coordinates ("g1f3", "e7e8q"). Null when it names none.
 */
export function findPlay(legal: readonly Play[], text: string): Play | null {
  const typed = text.trim()
  const bySan = legal.find(
    (play) => play.san === typed || stripMarks(play.san) === stripMarks(typed),
  )
  if (bySan) return bySan
  const coords = /^([a-h][1-8])-?([a-h][1-8])=?([qrbn])?$/i.exec(typed)
  if (!coords) return null
  const [, from, to, promotion] = coords
  return (
    legal.find(
      (play) =>
        play.from === from!.toLowerCase() &&
        play.to === to!.toLowerCase() &&
        (play.promotion ?? '') === (promotion?.toLowerCase() ?? (play.promotion ? 'q' : '')),
    ) ?? null
  )
}

/** SAN without its check and annotation marks, so "Qh5+" and "Qh5" name the same move. */
const stripMarks = (san: string) =>
  san.replace(/[+#!?]/g, '').replace(/^0-0(-0)?$/, (m) => m.replace(/0/g, 'O'))
