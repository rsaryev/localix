import { SIZE, type Game } from './game'

/**
 * The game as TEXT for the chat agent — its `snake` tool and the context the view publishes. The
 * agent never steers; it reads the board to talk about it.
 */

/** The grid: `H` the head, `o` the body, `*` the food, `.` empty. */
export function drawBoard(game: Pick<Game, 'snake' | 'food'>): string {
  const body = new Set(game.snake.slice(1))
  return Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, column) => {
      const cell = row * SIZE + column
      if (cell === game.snake[0]) return 'H'
      if (body.has(cell)) return 'o'
      return cell === game.food ? '*' : '.'
    }).join(''),
  ).join('\n')
}

/** Who steers, in the agent's words. */
export const controlLine = (game: Game): string =>
  game.mode === 'user'
    ? 'The user steers the snake.'
    : 'The decision model steers the snake. You never move it.'

/** How the game ended, or null while it goes on. */
export function endLine(game: Game): string | null {
  if (game.status === 'won') return `The snake fills the board — won with ${game.score} food.`
  if (game.status === 'over') return `The snake crashed after eating ${game.score}.`
  return null
}

/** Everything needed to talk about the game: who steers, the score and the board. */
export function describeGame(game: Game): string {
  return [
    `Snake on a ${SIZE}×${SIZE} grid — ${controlLine(game)}`,
    `Score ${game.score} · best ${game.best} · length ${game.snake.length} · heading ${game.heading}.`,
    endLine(game),
    '',
    drawBoard(game),
  ]
    .filter((line) => line !== null)
    .join('\n')
}
