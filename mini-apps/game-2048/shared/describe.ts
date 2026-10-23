import { legalDirections, SIZE, type Game } from './game'

/**
 * The game as TEXT for the agent — tool results, the wake that hands it the board, and the context
 * the view publishes. One module, so every one of them describes the same position.
 */

/** The board as a grid, empty cells as dots. */
export function drawBoard(game: Pick<Game, 'board'>): string {
  return Array.from({ length: SIZE }, (_, row) =>
    game.board
      .slice(row * SIZE, row * SIZE + SIZE)
      .map((value) => String(value || '.').padStart(5))
      .join(''),
  ).join('\n')
}

/** Who controls the board, in the agent's words. */
export const controlLine = (game: Game): string =>
  game.mode === 'user'
    ? 'The user controls the board.'
    : game.opponent === 'decision'
      ? 'The decision model plays the board; you do not move. The user can switch the player back to you on the board.'
      : 'You control the board.'

/** How the game ended, or null while it goes on. */
export function endLine(game: Game): string | null {
  if (game.status === 'won') return `The 2048 tile is on the board — won in ${game.moves} moves.`
  if (game.status === 'over') return `No moves remain — the game ended after ${game.moves} moves.`
  return null
}

/** Everything needed to act: the score, the board and the directions that would move it. */
export function describeGame(game: Game): string {
  const legal = legalDirections(game.board)
  return [
    `2048 — ${controlLine(game)}`,
    `Score ${game.score} · best ${game.best} · ${game.moves} moves.`,
    endLine(game),
    '',
    drawBoard(game),
    ...(game.status === 'playing'
      ? ['', `Directions that move the board: ${legal.join(', ')}.`]
      : []),
  ]
    .filter((line) => line !== null)
    .join('\n')
}
