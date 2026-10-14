import { agentPlays, type Game } from '../../shared/game'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces.
 *
 * `shared/describe.ts` speaks from the agent's seat ("You control the board"); the view speaks to
 * whoever is looking at the board ("Your move", "The agent is playing"). Pure, so every state the
 * board can be in has a sentence a test can read.
 */

/** The headline beside the board. */
export function headline(game: Game): string {
  if (game.status === 'won')
    return game.mode === 'agent' ? 'The agent reached 2048' : 'You reached 2048'
  if (game.status === 'over') return 'No moves left'
  if (game.mode === 'user') return 'Your move'
  if (game.waiting?.status === 'unreachable') return 'The agent could not be reached'
  return 'The agent is playing'
}

/** "Score 1,204 · Best 2,380 · 96 moves" — the numbers under the headline. */
export function scoreLine(game: Game): string {
  const number = (value: number) => value.toLocaleString('en')
  const moves = game.moves === 1 ? '1 move' : `${number(game.moves)} moves`
  return `Score ${number(game.score)} · Best ${number(game.best)} · ${moves}`
}

/** What a screen reader hears when the board changes: the move just made, then the state. */
export function announcement(game: Game): string {
  const steps = game.lastTurn?.steps ?? []
  const who = game.mode === 'agent' ? 'The agent' : 'You'
  const moved =
    steps.length === 0
      ? 'New game.'
      : steps.length === 1
        ? `${who} moved ${steps[0]!.direction}.`
        : `${who} made ${steps.length} moves.`
  return `${moved} ${headline(game)}. ${scoreLine(game)}.`
}

/** The result card's line under its title. */
export const resultLine = (game: Game): string =>
  `${game.status === 'won' ? 'The 2048 tile is on the board.' : 'The board is full and no tiles can merge.'} ${scoreLine(game)}.`

/** Whether the status should offer to ask the agent again. */
export const mayRemind = (game: Game, now: number, patienceMs: number): boolean =>
  agentPlays(game) &&
  (game.waiting?.status !== 'thinking' || now - Date.parse(game.waiting.since) >= patienceMs)

/** "12s", "1m 05s" — how long since the agent last moved. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
