import {
  MoveRefused,
  place,
  shift,
  spawnTile,
  statusOf,
  type Direction,
  type Game,
  type Mode,
  type Step,
} from './game'

/**
 * PLAYING a call's worth of moves, as one change to the game.
 *
 * The agent plans without seeing the tile that spawns after each move, and it plans in one of two
 * ways:
 *
 * - `moves` — an exact list. A move that would not change the board is SKIPPED, not refused:
 *   refusing the first no-op threw the rest of a good plan away and failed the whole call although
 *   earlier moves had played (10 of 15 calls in an early trial).
 * - `prefer` — an order of directions, resolved move by move: each move takes the first direction
 *   in the order that changes the board as it is THEN. This is the corner strategy the skill
 *   describes ("mostly down and left, right when neither moves, up last"), which a fixed list
 *   cannot express. An agent that tried lists: it alternated two directions,
 *   switched corners every call, and saw 70–90% of its moves skipped. On the real rules the same
 *   list play averages ~1,200 points in ~11 calls; the order averages ~2,600 in ~8
 *   (300 simulated games each).
 */

/** How a call chooses its moves. */
export type Plan = { moves: readonly Direction[] } | { prefer: readonly Direction[]; count: number }

/** What a call played. */
export interface Played {
  game: Game
  played: Direction[]
  /** List moves that would not change the board — skipped, not refused. */
  skipped: Direction[]
  /** Moves the plan still held when it stopped. */
  unplayed: number
  /** Why it stopped early: the game ended, or no preferred direction moved the board. */
  stop: 'ended' | 'stuck' | null
}

/**
 * Play `plan` for `by`. Only a board that may not be moved at all — the game is over, or the other
 * side controls it — is refused, before anything is played.
 */
export function playMoves(
  game: Game,
  plan: Plan,
  by: Mode,
  now: string,
  random: () => number,
): Played {
  if (game.status !== 'playing') throw new MoveRefused('This game has ended. Start a new game.')
  if (game.mode !== by)
    throw new MoveRefused(
      by === 'agent'
        ? 'The user controls this board now. Stop moving; the user can hand it back.'
        : 'The agent controls this board. Choose "I play" to take it back.',
    )
  const total = 'moves' in plan ? plan.moves.length : plan.count
  let board: number[] = [...game.board]
  let points = 0
  let stop: Played['stop'] = null
  const steps: Step[] = []
  const played: Direction[] = []
  const skipped: Direction[] = []
  let index = 0
  for (; index < total; index++) {
    let direction: Direction
    if ('moves' in plan) {
      direction = plan.moves[index]!
      if (!shift(board, direction).changed) {
        skipped.push(direction)
        continue
      }
    } else {
      const found = plan.prefer.find((candidate) => shift(board, candidate).changed)
      if (!found) {
        stop = 'stuck'
        break
      }
      direction = found
    }
    const moved = shift(board, direction)
    // A move that changed the board always frees a cell: a slide needs one, a merge makes one.
    const spawn = spawnTile(moved.board, random)!
    board = place(moved.board, spawn)
    points += moved.points
    steps.push({ direction, spawn })
    played.push(direction)
    if (statusOf(board) !== 'playing') {
      index++
      stop = 'ended'
      break
    }
  }
  const unplayed = total - index
  if (steps.length === 0) return { game, played, skipped, unplayed, stop }
  const score = game.score + points
  return {
    game: {
      ...game,
      board,
      score,
      best: Math.max(game.best, score),
      moves: game.moves + steps.length,
      status: statusOf(board),
      lastTurn: { from: [...game.board], steps },
      // The agent moving IS the agent at the board: the view's clock runs from its last move.
      waiting: by === 'agent' ? { since: now, status: 'thinking' } : null,
    },
    played,
    skipped,
    unplayed,
    stop,
  }
}

/** The board `steps` lead to from `from` — what the view replays, one move at a time. */
export const replay = (from: readonly number[], steps: readonly Step[]): number[] =>
  steps.reduce<number[]>(
    (board, step) => place(shift(board, step.direction).board, step.spawn),
    [...from],
  )

/** One move by the person, or a {@link MoveRefused} saying why there is none. */
export function applyMove(
  game: Game,
  direction: Direction,
  by: Mode,
  now: string,
  random: () => number,
): Game {
  const result = playMoves(game, { moves: [direction] }, by, now, random)
  if (result.played.length === 0) throw new MoveRefused(`The board cannot move ${direction}.`)
  return result.game
}
