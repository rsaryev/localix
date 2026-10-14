import { lineName } from '../../shared/describe'
import { cellName, type Game, type Move, type Record } from '../../shared/game'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's seat ("Your turn (O)"); the view speaks to whoever
 * is looking at the board ("Your turn", "The agent won with the top row"). Pure, so every state the
 * board can be in has a sentence a test can read.
 */

const who = (move: Move) => (move.by === 'you' ? 'You' : 'The agent')

/** "The agent played the top left (cell 1)." */
export const moveSentence = (move: Move) => `${who(move)} played ${cellName(move.cell)}.`

/** The headline beside the board. */
export function headline(game: Game): string {
  if (game.status === 'won') return 'You won'
  if (game.status === 'lost') return 'The agent won'
  if (game.status === 'draw') return 'Draw'
  if (game.turn === 'X') return 'Your turn'
  if (game.waiting?.status === 'unreachable') return 'The agent could not be reached'
  return 'The agent is thinking'
}

/** What a screen reader hears when the board changes: the last move, then what it means now. */
export function announcement(game: Game): string {
  const last = game.moves.at(-1)
  const line = game.line ? ` with ${lineName(game.line)}` : ''
  return [
    last ? moveSentence(last) : 'New game.',
    `${headline(game)}${game.status === 'playing' ? '' : line}.`,
  ].join(' ')
}

/** Who opens the next game — the side that did not open this one. */
export const nextOpener = (game: Game): string =>
  game.first === 'O' ? 'you start' : 'the agent starts'

/** " · Score 2–1, 3 draws" — the table's running score, empty before the first game ends. */
export function scoreLine(record: Record): string {
  if (record.won + record.lost + record.draw === 0) return ''
  const draws = record.draw === 1 ? '1 draw' : `${record.draw} draws`
  return ` · Score ${record.won}–${record.lost}, ${draws}`
}

/** "12s", "1m 05s" — how long the agent has been thinking. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
