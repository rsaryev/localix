export { elapsed } from '@localixai/mini-app-sdk/agent-wait'
import { agentPlays, stopped, type Game } from '../../shared/game'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's side ("You control the board"); the view speaks to
 * whoever is looking at the board ("Your move", "The agent is playing"). Pure, so every state the
 * board can be in has a sentence a test can read.
 */

/** Who plays an `agent` board, in the person's words. */
export const playerName = (game: Pick<Game, 'opponent'>) =>
  game.opponent === 'decision' ? 'The decision model' : 'The agent'

/**
 * The headline beside the board — a word or two, because who plays is already in the control row
 * beside it. {@link spokenHeadline} is the full sentence a screen reader hears.
 */
export function headline(game: Game): string {
  if (game.status === 'won') return 'Reached 2048'
  if (game.status === 'over') return 'No moves left'
  if (game.mode === 'user') return 'Your move'
  if (game.waiting?.status === 'unreachable') return stopped(game) ? 'Paused' : 'Stopped'
  return 'Playing'
}

/** The headline as a sentence that names who plays. */
export function spokenHeadline(game: Game): string {
  if (game.status === 'won')
    return game.mode === 'agent' ? `${playerName(game)} reached 2048` : 'You reached 2048'
  if (game.status === 'over' || game.mode === 'user') return headline(game)
  if (game.waiting?.status === 'unreachable') return `${playerName(game)} could not be reached`
  return `${playerName(game)} is playing`
}

/** "Score 1,204 · Best 2,380 · 96 moves" — the numbers under the headline. */
export function scoreLine(game: Game): string {
  const number = (value: number) => value.toLocaleString('en')
  const moves = game.moves === 1 ? '1 move' : `${number(game.moves)} moves`
  return `Score ${number(game.score)} · Best ${number(game.best)} · ${moves}`
}

/** "Score 1,204 · Best 2,380" — the short line the view shows under the headline. */
export function shortScoreLine(game: Game): string {
  const number = (value: number) => value.toLocaleString('en')
  return `Score ${number(game.score)} · Best ${number(game.best)}`
}

/** What a screen reader hears when the board changes: the move just made, then the state. */
export function announcement(game: Game): string {
  const steps = game.lastTurn?.steps ?? []
  const who = game.mode === 'agent' ? playerName(game) : 'You'
  const moved =
    steps.length === 0
      ? 'New game.'
      : steps.length === 1
        ? `${who} moved ${steps[0]!.direction}.`
        : `${who} made ${steps.length} moves.`
  return `${moved} ${spokenHeadline(game)}. ${scoreLine(game)}.`
}

/** The result card's line under its title. */
export const resultLine = (game: Game): string =>
  `${game.status === 'won' ? 'The 2048 tile is on the board.' : 'The board is full and no tiles can merge.'} ${scoreLine(game)}.`

/** Whether the status should offer to ask the agent again. */
export const mayRemind = (game: Game, now: number, patienceMs: number): boolean =>
  agentPlays(game) &&
  (game.waiting?.status !== 'thinking' || now - Date.parse(game.waiting.since) >= patienceMs)
