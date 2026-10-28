import { movesNow, QUIET_DRAW_PLIES, type Game, type Move, type GameRecord } from './game'
import { moveName } from './notation'
import { countPieces, other } from './rules'

/**
 * The game as TEXT for the agent — tool results, the wake that asks for its move, and the context
 * the view publishes. One module, so every one of them describes the same position.
 *
 * Written from the agent's side: it plays the user's opposite colour — unless the table's opponent is
 * the decision model, which then plays that colour and the agent only watches. The board is always drawn
 * from White's side with files and ranks, the way the notation reads, whichever colour the user
 * plays.
 */

const SYMBOL = { white: ['w', 'W'], black: ['b', 'B'] } as const

/** Who plays the other colour, from the agent's side: itself, or the decision model. */
const theirSide = (game: Pick<Game, 'opponent'>) =>
  game.opponent === 'decision'
    ? { who: 'The decision model', whose: 'The decision model’s', was: 'was' }
    : { who: 'You', whose: 'Your', was: 'were' }

/** The board as a grid: w/b men, W/B kings, "." for a free dark square, " " for a light one. */
export function drawBoard(game: Pick<Game, 'board'>): string {
  const files = '   a b c d e f g h'
  const rows = Array.from({ length: 8 }, (_, row) => {
    const cells = Array.from({ length: 8 }, (_, col) => {
      const piece = game.board[row * 8 + col]
      if (piece) return SYMBOL[piece.side][piece.king ? 1 : 0]
      return (row + col) % 2 === 1 ? '.' : ' '
    })
    return `${8 - row}  ${cells.join(' ')}  ${8 - row}`
  })
  return [files, ...rows, files].join('\n')
}

/** One sentence: who moves next, or how the game ended. */
export function statusLine(game: Game): string {
  const them = other(game.you)
  if (game.ending === 'resign')
    return `The user won — ${theirSide(game).who.toLowerCase()} resigned.`
  if (game.status === 'won') return `The user won — ${them} has no move left.`
  if (game.status === 'lost') return `${theirSide(game).who} won — ${game.you} has no move left.`
  if (game.status === 'draw')
    return `Draw — ${QUIET_DRAW_PLIES / 2} moves each without a capture or a man moved.`
  if (game.turn === game.you) return `The user’s turn (${game.you}).`
  return `${theirSide(game).whose} turn (${them}).`
}

/**
 * The running score at this table, from the agent's side — so a woken turn knows the history of
 * this chat's games without reading them back from a transcript that checkpoints may have folded.
 */
export function recordLine(record: GameRecord): string | null {
  if (record.won + record.lost + record.draw === 0) return null
  return `Score at this table: you ${record.lost}, the user ${record.won}, draws ${record.draw}.`
}

/** "The user played c3-d4." / "You captured d6:f4:d2, taking 2 pieces, and were crowned." */
export function moveLine(move: Move, game: Pick<Game, 'opponent'> = { opponent: null }): string {
  const chat = theirSide(game)
  const who = move.by === 'you' ? 'The user' : chat.who
  const taken = move.captured.length
  const verb = taken > 0 ? 'captured' : 'played'
  const count = taken > 0 ? `, taking ${taken === 1 ? 'a piece' : `${taken} pieces`}` : ''
  const crowned = move.crowned ? `, and ${move.by === 'agent' ? chat.was : 'was'} crowned` : ''
  return `${who} ${verb} ${moveName(move)}${count}${crowned}.`
}

export const lastMoveLine = (game: Game): string | null => {
  const move = game.moves.at(-1)
  return move ? moveLine(move, game) : null
}

/** The moves the side to play may make, in notation; a capture, when there is one, is compulsory. */
export function legalLine(game: Game): string | null {
  const legal = movesNow(game)
  if (legal.length === 0) return null
  const names = legal.map(moveName).join(', ')
  return legal[0]!.captured.length > 0
    ? `Legal moves (a capture is compulsory): ${names}.`
    : `Legal moves: ${names}.`
}

/** Everything the agent needs to act: the position, whose move, the legal moves. */
export function describeGame(game: Game): string {
  const them = other(game.you)
  const pieces = `Pieces: white ${countPieces(game.board, 'white')}, black ${countPieces(game.board, 'black')}.`
  return [
    game.opponent === 'decision'
      ? `Checkers (Russian draughts) — the user plays ${game.you} against the decision model (${them}). You do not move at this table; the user can switch the opponent back to you on the board.`
      : `Checkers (Russian draughts) — the user plays ${game.you} against you, as ${them}.`,
    recordLine(game.record),
    lastMoveLine(game),
    statusLine(game),
    '',
    drawBoard(game),
    '',
    pieces,
    legalLine(game),
  ]
    .filter((line) => line !== null)
    .join('\n')
}
