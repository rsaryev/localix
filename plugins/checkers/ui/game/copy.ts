import { QUIET_DRAW_PLIES, type Game, type Move, type GameRecord } from '../../shared/game'
import { moveName } from '../../shared/notation'
import { other, type Side } from '../../shared/rules'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's seat ("Your turn (black)"); the view speaks to
 * whoever is looking at the board ("Your turn", "The agent won"). Pure, so every state the board
 * can be in has a sentence a test can read.
 */

export const colour = (side: Side) => (side === 'white' ? 'White' : 'Black')

/** Who plays the other colour at this table, in the person's words. */
export const opponentName = (game: Pick<Game, 'opponent'>) =>
  game.opponent === 'decision' ? 'The decision model' : 'The agent'

/** " · Score 2–1, 3 draws" — the table's running score, empty before the first game ends. */
export function scoreLine(record: GameRecord): string {
  if (record.won + record.lost + record.draw === 0) return ''
  const draws = record.draw === 1 ? '1 draw' : `${record.draw} draws`
  return ` · Score ${record.won}–${record.lost}, ${draws}`
}

/** "The agent played f6-e5." / "You captured d4:f6, taking a piece." */
export function moveSentence(move: Move, game: Pick<Game, 'opponent'>): string {
  const taken = move.captured.length
  const verb = taken > 0 ? 'captured' : 'played'
  const count = taken > 0 ? `, taking ${taken === 1 ? 'a piece' : `${taken} pieces`}` : ''
  const crowned = move.crowned ? ', and crowned a king' : ''
  const who = move.by === 'you' ? 'You' : opponentName(game)
  return `${who} ${verb} ${moveName(move)}${count}${crowned}.`
}

/** The headline beside the board. */
export function headline(game: Game): string {
  if (game.status === 'won') return 'You won'
  if (game.status === 'lost') return 'You lost'
  if (game.status === 'draw') return 'Draw'
  if (game.turn === game.you) return 'Your turn'
  if (game.waiting?.status === 'unreachable') return 'No answer'
  return 'Thinking'
}

/** How the game ended, in one sentence for the result card. */
export function endingSentence(game: Game): string {
  if (game.ending === 'resign') return `${opponentName(game)} resigned.`
  if (game.ending === 'quiet')
    return `${QUIET_DRAW_PLIES / 2} moves each without a capture or a man moved.`
  const loser = game.status === 'won' ? other(game.you) : game.you
  return `${colour(loser)} has no move left.`
}

/** What a screen reader hears when the board changes: the last move, then what it means now. */
export function announcement(game: Game): string {
  const last = game.moves.at(-1)
  return [last ? moveSentence(last, game) : 'New game.', `${headline(game)}.`].join(' ')
}

/** Which colour the person plays next game — the other one. */
export const nextColour = (game: Game) => `you play ${colour(other(game.you)).toLowerCase()}`

/** "12s", "1m 05s" — how long the agent has been thinking. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
