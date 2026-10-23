import { elapsed } from '@localixai/plugin-sdk/agent-wait'
import { opponentName } from '@localixai/plugin-sdk/opponent'
import {
  theirMove,
  viewerMayMove,
  viewOwesAgentMove,
  type Move,
  type PlayerView,
  type RoundView,
} from '../../shared/game'

/** Shared by every game: the wait's clock and the opponent in the person's words. */
export { elapsed, opponentName }

/**
 * The table in the PERSON's words — the view's headline and what a screen reader announces.
 * `shared/describe.ts` speaks from the agent's seat; this speaks to whoever is looking. Pure, so
 * every state the table can be in has a sentence a test can read.
 */

export const MOVE_GLYPH: Record<Move, string> = { rock: '✊', paper: '✋', scissors: '✌️' }
export const MOVE_LABEL: Record<Move, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
}

const HOW: Record<Move, string> = {
  rock: 'Rock blunts scissors',
  paper: 'Paper covers rock',
  scissors: 'Scissors cut paper',
}

/** "Paper covers rock." — why a revealed round went the way it did. */
export function verdictLine(round: RoundView): string | null {
  const theirs = theirMove(round)
  if (round.outcome === null || !round.mine || !theirs) return null
  if (round.outcome === 'draw') return `Both played ${round.mine}.`
  return `${HOW[round.outcome === 'won' ? round.mine : theirs]}.`
}

/** The other seat's short name, over its hand and on the scoreboard. */
export const opponentTitle = (view: Pick<PlayerView, 'opponent'>) =>
  view.opponent === 'decision' ? 'Model' : 'Agent'

/** The headline beside the table. */
export function headline(view: PlayerView): string {
  const round = view.round
  if (round.outcome === 'won') return 'You won the round'
  if (round.outcome === 'lost') return 'You lost the round'
  if (round.outcome === 'draw') return 'Draw'
  if (viewerMayMove(view)) return round.theirs ? 'Sealed — your turn' : 'You open — choose'
  if (viewOwesAgentMove(view)) {
    if (view.waiting?.status === 'unreachable') return 'No answer'
    return 'Choosing'
  }
  return 'Waiting'
}

/** What a screen reader hears when the table changes. */
export function announcement(view: PlayerView): string {
  const verdict = verdictLine(view.round)
  return [headline(view), verdict].filter(Boolean).join('. ').concat('.')
}

/** Who opens the next round — the side that did not open this one. */
export const nextOpener = (view: PlayerView): string =>
  view.round.first === 'agent' ? 'you open' : `${opponentName(view).toLowerCase()} opens`
