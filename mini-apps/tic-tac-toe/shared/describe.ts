import { LINES, cellName, freeCells, type Game, type GameRecord } from './game'

/**
 * The game as TEXT for the agent — tool results, the wake that asks for its move, and the context
 * the view publishes. One module, so every one of them describes the same position.
 *
 * Written from the agent's side: it plays O, the user plays X — unless the table's opponent is the
 * decision model, which then plays O and the agent only watches.
 */

/** Who O is, from the agent's side: itself, or the decision model the user chose. */
const oSide = (game: Pick<Game, 'opponent'>) =>
  game.opponent === 'decision'
    ? { who: 'The decision model', whose: 'The decision model’s' }
    : { who: 'You', whose: 'Your' }

const LINE_NAMES = [
  'the top row',
  'the middle row',
  'the bottom row',
  'the left column',
  'the middle column',
  'the right column',
  'the diagonal from the top left',
  'the diagonal from the top right',
]

/** Which line three cells are, in words. */
export function lineName(line: readonly number[]): string {
  const index = LINES.findIndex((candidate) => candidate.every((cell, i) => cell === line[i]))
  return LINE_NAMES[index] ?? 'a line'
}

/** Marks where played, the cell's number where free — the numbers the move tool takes. */
export function drawBoard(game: Game): string {
  const at = (cell: number) => game.board[cell] ?? String(cell + 1)
  const row = (start: number) => ` ${at(start)} | ${at(start + 1)} | ${at(start + 2)}`
  return [row(0), '---+---+---', row(3), '---+---+---', row(6)].join('\n')
}

/** One sentence: who moves next, or how the game ended. */
export function statusLine(game: Game): string {
  const line = game.line ? ` with ${lineName(game.line)}` : ''
  if (game.status === 'won') return `The user won${line}.`
  if (game.status === 'lost') return `${oSide(game).who} won${line}.`
  if (game.status === 'draw') return 'Draw — the board is full.'
  if (game.turn === 'X') return 'The user’s turn (X).'
  return `${oSide(game).whose} turn (O).`
}

/** The last move, as a sentence: "The user played X in the centre (cell 5)." */
export function lastMoveLine(game: Game): string | null {
  const move = game.moves.at(-1)
  if (!move) return null
  const who = move.by === 'you' ? 'The user' : oSide(game).who
  return `${who} played ${move.mark} in ${cellName(move.cell)}.`
}

/**
 * The running score at this table, from the agent's side — so a woken turn knows the history of
 * this chat's games without reading them back from a transcript that checkpoints may have folded.
 */
export function recordLine(record: GameRecord): string | null {
  const played = record.won + record.lost + record.draw
  if (played === 0) return null
  return `Score at this table: you ${record.lost}, the user ${record.won}, draws ${record.draw}.`
}

/** The free cells where `mark` completes a line now. */
function winningCells(board: Game['board'], mark: 'X' | 'O'): number[] {
  return freeCells(board).filter((cell) =>
    LINES.some(
      (line) => line.includes(cell) && line.every((at) => at === cell || board[at] === mark),
    ),
  )
}

/**
 * The cell that decides this move, when one does: where O wins now, else where X would win next.
 * The skill already says "take a winning cell, else block"; an agent — answering in
 * 25 tokens with no reasoning — played cell 6 with X on 1 and 3, and lost on 2. Naming the cell
 * makes the rule it was given something it can read rather than something it has to work out.
 */
export function threatLine(game: Game): string | null {
  if (game.status !== 'playing') return null
  const win = winningCells(game.board, 'O').map((cell) => cell + 1)
  if (win.length) return `You win at cell ${win.join(' or ')}.`
  const block = winningCells(game.board, 'X').map((cell) => cell + 1)
  if (block.length) return `The user wins next at cell ${block.join(' or ')} unless you take it.`
  return null
}

/** Everything the agent needs to act: the position, whose move, the free cells. */
export function describeGame(game: Game): string {
  const free = freeCells(game.board).map((cell) => cell + 1)
  return [
    game.opponent === 'decision'
      ? 'Tic-Tac-Toe — the user plays X against the decision model (O). You do not move at this table; the user can switch the opponent back to you on the board.'
      : 'Tic-Tac-Toe — the user plays X against you, as O.',
    recordLine(game.record),
    lastMoveLine(game),
    statusLine(game),
    '',
    drawBoard(game),
    ...(game.status === 'playing' ? ['', `Free cells: ${free.join(', ')}.`] : []),
  ]
    .filter((line) => line !== null)
    .join('\n')
}
