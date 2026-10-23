import { modelPlays, stopped, type Game } from '../../shared/game'

/**
 * The game in the PERSON's words — the view's headline and what a screen reader announces. Short,
 * because who plays is already in the control row beside it; {@link spokenHeadline} names them.
 */

export function headline(game: Game, running: boolean): string {
  if (game.status === 'won') return 'Board filled'
  if (game.status === 'over') return 'Crashed'
  if (game.mode === 'user') return running ? 'Your snake' : 'Press an arrow key'
  if (game.waiting?.status === 'unreachable') return stopped(game) ? 'Paused' : 'Stopped'
  return 'Playing'
}

/** The headline as a sentence that names who plays. */
export function spokenHeadline(game: Game): string {
  const who = game.mode === 'model' ? 'The decision model' : 'You'
  if (game.status === 'won') return `${who} filled the board`
  if (game.status === 'over') return `${who} crashed`
  if (game.mode === 'user') return 'Your move'
  if (game.waiting?.status === 'unreachable') return 'The decision model stopped'
  return 'The decision model is playing'
}

/** "Score 12 · Best 30" — the numbers under the headline. */
export const scoreLine = (game: Game): string => `Score ${game.score} · Best ${game.best}`

/** What a screen reader hears when the game's state changes (not on every tick). */
export const announcement = (game: Game): string => `${spokenHeadline(game)}. ${scoreLine(game)}.`

/** The result card's line under its title. */
export const resultLine = (game: Game): string =>
  `${game.status === 'won' ? 'The snake fills the whole board.' : `Length ${game.snake.length}.`} ${scoreLine(game)}.`

/** Whether the status offers Continue: the model is not running and the game is on. */
export const mayContinue = (game: Game): boolean =>
  modelPlays(game) && game.waiting?.status !== 'thinking'
