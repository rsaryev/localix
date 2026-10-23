import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { z } from 'zod'

/**
 * The Snake rules both halves agree on: the contract the routes answer with, and the one tick that
 * changes it — pure and DETERMINISTIC, so the backend, the view and the tests cannot disagree
 * about a board.
 *
 * Cells are 0–255, row by row from the top left of a 16×16 grid. The snake is a list of cells,
 * head first. One tick moves the head one cell along `heading`; on food the snake grows and new
 * food appears, on a wall or its own body it dies. Who steers is the board's `mode`: the person,
 * or the host's decision model. There is no chat-agent player.
 *
 * Food is placed by a seeded generator kept in the game (`seed`), not by `Math.random`: the view
 * plays the person's ticks itself and sends only the headings it played, and the backend replays
 * them from the stored game to the SAME board — so the board the person sees is the one that is
 * saved, without the backend having to trust a board the view made up.
 */

export const SIZE = 16
export const CELLS = SIZE * SIZE
export const directions = ['up', 'down', 'left', 'right'] as const
export type Direction = (typeof directions)[number]
export const modes = ['user', 'model'] as const
export type Mode = (typeof modes)[number]

/** How long one tick of the person's game lasts. */
export const TICK_MS = 150

const cellIndex = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1)

/** While the decision model plays: when it was asked, and whether it can answer. */
export { agentWaitSchema, type AgentWait }

export const gameSchema = z.object({
  id: z.string().min(1),
  /** Head first. */
  snake: z.array(cellIndex).min(1).max(CELLS),
  heading: z.enum(directions),
  food: cellIndex.nullable(),
  mode: z.enum(modes),
  /** `won`: the snake fills the board. */
  status: z.enum(['playing', 'over', 'won']),
  score: z.number().int().min(0),
  best: z.number().int().min(0),
  /** Ticks played in this game. */
  tick: z.number().int().min(0),
  /** The food generator's state (a 32-bit integer). */
  seed: z.number().int().min(0).max(0xffffffff),
  waiting: agentWaitSchema.nullable(),
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

/** A move the rules refuse, in a sentence the person can act on. */
export class MoveRefused extends Error {
  override name = 'MoveRefused'
}

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

/** The cell one step from `cell` along `direction`, or null past a wall. */
export function neighbour(cell: number, direction: Direction): number | null {
  const row = Math.floor(cell / SIZE)
  const column = cell % SIZE
  if (direction === 'up') return row > 0 ? cell - SIZE : null
  if (direction === 'down') return row < SIZE - 1 ? cell + SIZE : null
  if (direction === 'left') return column > 0 ? cell - 1 : null
  return column < SIZE - 1 ? cell + 1 : null
}

/** The headings the snake may take now: every direction but straight back into itself. */
export const turns = (game: Pick<Game, 'heading' | 'snake'>): Direction[] =>
  game.snake.length > 1
    ? directions.filter((direction) => direction !== OPPOSITE[game.heading])
    : [...directions]

/** The heading a request becomes: a reversal into the body keeps the current heading. */
export const steer = (game: Pick<Game, 'heading' | 'snake'>, direction: Direction): Direction =>
  turns(game).includes(direction) ? direction : game.heading

/** The next state of a 32-bit generator (mulberry32), and a number in [0, 1) from it. */
function next(seed: number): { seed: number; value: number } {
  const state = (seed + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return { seed: state, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Food in a free cell, drawn from `seed`; null when the snake fills the board. */
function placeFood(snake: readonly number[], seed: number): { food: number | null; seed: number } {
  const taken = new Set(snake)
  const free = Array.from({ length: CELLS }, (_, cell) => cell).filter((cell) => !taken.has(cell))
  if (free.length === 0) return { food: null, seed }
  const drawn = next(seed)
  return { food: free[Math.floor(drawn.value * free.length)]!, seed: drawn.seed }
}

export function newGame(input: {
  id: string
  mode: Mode
  now: string
  best?: number
  seed: number
}): Game {
  const middle = (SIZE / 2) * SIZE + SIZE / 2
  const snake = [middle, middle - 1, middle - 2]
  const placed = placeFood(snake, input.seed >>> 0)
  return {
    id: input.id,
    snake,
    heading: 'right',
    food: placed.food,
    mode: input.mode,
    status: 'playing',
    score: 0,
    best: input.best ?? 0,
    tick: 0,
    seed: placed.seed,
    waiting: null,
    startedAt: input.now,
  }
}

/** What one tick along `direction` would do, without doing it. */
export function lookAhead(game: Pick<Game, 'snake' | 'food'>, direction: Direction) {
  const head = neighbour(game.snake[0]!, direction)
  const eats = head !== null && head === game.food
  // The tail moves out of its cell this tick unless the snake grows.
  const body = eats ? game.snake : game.snake.slice(0, -1)
  const dies = head === null || body.includes(head)
  return { head, eats, dies, body: dies || head === null ? body : [head, ...body] }
}

/** The game after one tick along `direction` (a reversal keeps the heading). */
export function step(game: Game, direction: Direction): Game {
  if (game.status !== 'playing') return game
  const heading = steer(game, direction)
  const ahead = lookAhead(game, heading)
  if (ahead.dies) return { ...game, heading, status: 'over', tick: game.tick + 1 }
  if (!ahead.eats) return { ...game, heading, snake: ahead.body, tick: game.tick + 1 }
  const score = game.score + 1
  const placed = placeFood(ahead.body, game.seed)
  return {
    ...game,
    heading,
    snake: ahead.body,
    food: placed.food,
    seed: placed.seed,
    score,
    best: Math.max(game.best, score),
    status: placed.food === null ? 'won' : 'playing',
    tick: game.tick + 1,
  }
}

/** The game after `headings`, one tick each, stopping where the game ends. */
export const replay = (game: Game, headings: readonly Direction[]): Game =>
  headings.reduce((current, heading) => step(current, heading), game)

/** Cells reachable from `from` without crossing `blocked` (a flood fill). */
export function reachable(from: number | null, blocked: readonly number[]): number {
  if (from === null) return 0
  const wall = new Set(blocked)
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const cell = queue.pop()!
    for (const direction of directions) {
      const near = neighbour(cell, direction)
      if (near === null || wall.has(near) || seen.has(near)) continue
      seen.add(near)
      queue.push(near)
    }
  }
  return seen.size
}

/** Steps from `a` to `b` on the grid, ignoring the body. */
export const distance = (a: number, b: number) =>
  Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs((a % SIZE) - (b % SIZE))

/** Whether the decision model is the one steering now. */
export const modelPlays = (game: Pick<Game, 'mode' | 'status'> | null): boolean =>
  game?.mode === 'model' && game.status === 'playing'

/** The wait a person's Stop leaves: the model pauses until Continue. */
export const STOPPED_REASON = 'Stopped by you.'

/** Whether a person stopped the model on this board (Continue resumes it). */
export const stopped = (game: Pick<Game, 'waiting'>): boolean =>
  game.waiting?.status === 'unreachable' && game.waiting.reason === STOPPED_REASON
