import { elapsed } from '@localixai/mini-app-sdk/agent-wait'
import { opponentName } from '@localixai/mini-app-sdk/opponent'
import { turnOf, type Game, type GameEnding, type Move, type GameRecord } from '../../shared/game'
import { other, type Side } from '../../shared/position'

/** Shared by every game: the wait's clock and the opponent in the person's words. */
export { elapsed, opponentName }

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's side ("Your turn (black)"); the view speaks to
 * whoever is looking at the board ("Your turn", "The agent won"). Pure, so every state the board
 * can be in has a sentence a test can read.
 */

export const colour = (side: Side) => (side === 'white' ? 'White' : 'Black')

/** " · Score 2–1, 3 draws" — the table's running score, empty before the first game ends. */
export function scoreLine(record: GameRecord): string {
  if (record.won + record.lost + record.draw === 0) return ''
  const draws = record.draw === 1 ? '1 draw' : `${record.draw} draws`
  return ` · Score ${record.won}–${record.lost}, ${draws}`
}

/** "The agent played Nf3." */
export const moveSentence = (move: Move, game: Pick<Game, 'opponent'>) =>
  `${move.by === 'you' ? 'You' : opponentName(game)} played ${move.san}.`

/** The headline beside the board. */
export function headline(game: Game): string {
  if (game.status === 'won') return 'You won'
  if (game.status === 'lost') return 'You lost'
  if (game.status === 'draw') return 'Draw'
  if (turnOf(game) === game.you) return 'Your turn'
  if (game.waiting?.status === 'unreachable') return 'No answer'
  return 'Thinking'
}

const ENDING: { [ending in GameEnding]: string } = {
  checkmate: 'Checkmate.',
  stalemate: 'Stalemate — no legal move, and no check.',
  threefold: 'The same position three times.',
  insufficient: 'Neither side has enough material to mate.',
  'fifty-move': 'Fifty moves each without a capture or a pawn move.',
  resign: 'The agent resigned.',
}

/** How the game ended, in one sentence for the result card. */
export const endingSentence = (game: Game): string => (game.ending ? ENDING[game.ending] : '')

/** What a screen reader hears when the board changes: the last move, then what it means now. */
export function announcement(game: Game): string {
  const last = game.moves.at(-1)
  return [last ? moveSentence(last, game) : 'New game.', `${headline(game)}.`].join(' ')
}

/** Which colour the person plays next game — the other one. */
export const nextColour = (game: Game) => `you play ${colour(other(game.you)).toLowerCase()}`
