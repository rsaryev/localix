import {
  positionOfGame,
  turnOf,
  type Game,
  type GameEnding,
  type Move,
  type GameRecord,
} from './game'
import { other } from './position'

/**
 * The game as TEXT for the agent — tool results, the wake that asks for its move, and the context
 * the view publishes. One module, so every one of them describes the same position.
 *
 * Written from the agent's seat: it plays the user's opposite colour. The board is drawn from
 * White's side with files and ranks, the way the notation reads, and the FEN is given too — the
 * notation models are best at reading a chess position in.
 */

const GLYPH: { [type: string]: string } = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' }

/** The board as a grid: upper case white, lower case black, "." an empty square. */
export function drawBoard(game: Pick<Game, 'moves'>): string {
  const { cells } = positionOfGame(game)
  const files = '   a b c d e f g h'
  const rows = Array.from({ length: 8 }, (_, row) => {
    const line = cells.slice(row * 8, row * 8 + 8).map(({ piece }) => {
      if (!piece) return '.'
      const glyph = GLYPH[piece.type] ?? '?'
      return piece.side === 'white' ? glyph.toUpperCase() : glyph
    })
    return `${8 - row}  ${line.join(' ')}  ${8 - row}`
  })
  return [files, ...rows, files].join('\n')
}

const ENDING: { [ending in GameEnding]: string } = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  threefold: 'threefold repetition',
  insufficient: 'insufficient material',
  'fifty-move': 'the fifty-move rule',
  resign: 'resignation',
}

/** One sentence: who moves next, or how the game ended. */
export function statusLine(game: Game): string {
  const how = game.ending ? ENDING[game.ending] : ''
  if (game.ending === 'resign') return 'The user won — you resigned.'
  if (game.status === 'won') return `The user won by ${how}.`
  if (game.status === 'lost') return `You won by ${how}.`
  if (game.status === 'draw') return `Draw by ${how}.`
  const check = positionOfGame(game).inCheck ? ' — in check' : ''
  if (turnOf(game) === game.you) return `The user’s turn (${game.you})${check}.`
  return `Your turn (${other(game.you)})${check}.`
}

/**
 * The running score at this table, from the agent's side — so a woken turn knows the history of
 * this chat's games without reading them back from a transcript that checkpoints may have folded.
 */
export function recordLine(record: GameRecord): string | null {
  if (record.won + record.lost + record.draw === 0) return null
  return `Score at this table: you ${record.lost}, the user ${record.won}, draws ${record.draw}.`
}

/** "The user played Nf3." */
export const moveLine = (move: Move) =>
  `${move.by === 'you' ? 'The user' : 'You'} played ${move.san}.`

export const lastMoveLine = (game: Game): string | null => {
  const move = game.moves.at(-1)
  return move ? moveLine(move) : null
}

/** The moves so far as numbered pairs: "1. e4 e5 2. Nf3 Nc6". */
export function movesLine(game: Pick<Game, 'moves'>): string | null {
  if (game.moves.length === 0) return null
  const pairs: string[] = []
  game.moves.forEach((move, index) => {
    if (index % 2 === 0) pairs.push(`${index / 2 + 1}. ${move.san}`)
    else pairs[pairs.length - 1] += ` ${move.san}`
  })
  return `Moves: ${pairs.join(' ')}`
}

/** The moves the side to play may make, in SAN. */
export function legalLine(game: Game): string | null {
  if (game.status !== 'playing') return null
  const legal = positionOfGame(game).legal
  return legal.length > 0 ? `Legal moves: ${legal.map((play) => play.san).join(', ')}.` : null
}

/** Everything the agent needs to act: the position, whose move, the legal moves. */
export function describeGame(game: Game): string {
  const { fen } = positionOfGame(game)
  return [
    `Chess — the user plays ${game.you} against you, as ${other(game.you)}.`,
    recordLine(game.record),
    lastMoveLine(game),
    statusLine(game),
    '',
    drawBoard(game),
    '',
    `FEN: ${fen}`,
    movesLine(game),
    legalLine(game),
  ]
    .filter((line) => line !== null)
    .join('\n')
}
