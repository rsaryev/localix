import {
  askDecisionForTurn,
  type DecisionAsk,
  type DecisionHost,
  type ChatRef,
} from '@localixai/mini-app-sdk/backend'

import { drawBoard } from '../shared/describe'
import {
  distance,
  lookAhead,
  reachable,
  turns,
  type AgentWait,
  type Direction,
  type Game,
} from '../shared/game'

/**
 * HOW THE BOARD ASKS THE DECISION MODEL FOR ITS NEXT MOVE — when the model steers.
 *
 * The mini app asks the host's decision model itself (`ctx.host.decisions`): one `choice` question
 * whose options are the headings the snake may take now (never straight back into itself). What
 * code can see for certain about each heading — whether it dies, whether it eats, how far the food
 * is after it, and how many free cells the head can still reach (a flood fill, the way to tell an
 * open move from one that walls the snake in) — is computed here and put in the state, so the
 * model weighs facts rather than tracing the body in its head; the pick is still the model's.
 */

export const DECISION_PURPOSE = 'move'

const DESCRIPTIONS: Record<Direction, string> = {
  up: 'Turn or keep going up',
  down: 'Turn or keep going down',
  left: 'Turn or keep going left',
  right: 'Turn or keep going right',
}

/** The board, the snake and what each heading would do; the one question: which heading. */
export function moveAsk(game: Game): DecisionAsk {
  const options = turns(game)
  const outcomes = Object.fromEntries(
    options.map((direction) => {
      const ahead = lookAhead(game, direction)
      return [
        direction,
        {
          dies: ahead.dies,
          eats_food: ahead.eats,
          steps_to_food_after:
            ahead.head === null || game.food === null ? null : distance(ahead.head, game.food),
          free_cells_reachable_after: ahead.dies ? 0 : reachable(ahead.head, ahead.body),
        },
      ]
    }),
  )
  return {
    state: {
      game: 'Snake on a 16×16 grid: the head moves one cell per move, eating food grows the snake, hitting a wall or the body ends the game',
      grid_rows_top_to_bottom: drawBoard(game).split('\n'),
      legend: 'H head, o body, * food, . empty',
      heading: game.heading,
      length: game.snake.length,
      what_each_heading_does: outcomes,
    },
    questions: {
      move: {
        type: 'choice',
        instructions:
          'Which heading is the best next move? Never choose one that dies while another does not. Prefer eating the food or getting closer to it, but not at the cost of walling the snake in: keep the free cells reachable after the move as large as the snake needs to keep moving.',
        criteria: Object.fromEntries(
          options.map((direction) => [direction, DESCRIPTIONS[direction]]),
        ),
      },
    },
  }
}

/** The decision model's next heading, or the wait that says why there is none. */
export async function askDecision(
  decisions: DecisionHost | undefined,
  chat: ChatRef,
  game: Game,
  now: string,
): Promise<{ direction: Direction } | { waiting: AgentWait }> {
  const turn = { ask: moveAsk(game), question: 'move', purpose: DECISION_PURPOSE }
  const answered = await askDecisionForTurn(decisions, chat, turn, now)
  return 'answer' in answered ? { direction: answered.answer.choice as Direction } : answered
}
