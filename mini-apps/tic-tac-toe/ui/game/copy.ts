import { elapsed } from '@localixai/mini-app-sdk/agent-wait'
import { opponentName } from '@localixai/mini-app-sdk/opponent'
import { lineName } from '../../shared/describe'
import { cellName, type Game, type Move, type GameRecord } from '../../shared/game'

/** Shared by every game: the wait's clock and the opponent in the person's words. */
export { elapsed, opponentName }

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's side ("Your turn (O)"); the view speaks to whoever
 * is looking at the board ("Your turn", "The agent won with the top row"). Pure, so every state the
 * board can be in has a sentence a test can read.
 */

/** "The agent played the top left (cell 1)." */
export const moveSentence = (move: Move, game: Pick<Game, 'opponent'>) =>
  `${move.by === 'you' ? 'You' : opponentName(game)} played ${cellName(move.cell)}.`

/** The headline beside the board. */
export function headline(game: Game): string {
  if (game.status === 'won') return 'You won'
  if (game.status === 'lost') return 'You lost'
  if (game.status === 'draw') return 'Draw'
  if (game.turn === 'X') return 'Your turn'
  if (game.waiting?.status === 'unreachable') return 'No answer'
  return 'Thinking'
}

/** What a screen reader hears when the board changes: the last move, then what it means now. */
export function announcement(game: Game): string {
  const last = game.moves.at(-1)
  const line = game.line ? ` with ${lineName(game.line)}` : ''
  return [
    last ? moveSentence(last, game) : 'New game.',
    `${headline(game)}${game.status === 'playing' ? '' : line}.`,
  ].join(' ')
}

/** Who opens the next game — the side that did not open this one. */
export const nextOpener = (game: Game): string =>
  game.first === 'O' ? 'you start' : `${opponentName(game).toLowerCase()} starts`

/** " · Score 2–1, 3 draws" — the table's running score, empty before the first game ends. */
export function scoreLine(record: GameRecord): string {
  if (record.won + record.lost + record.draw === 0) return ''
  const draws = record.draw === 1 ? '1 draw' : `${record.draw} draws`
  return ` · Score ${record.won}–${record.lost}, ${draws}`
}
