import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import { z } from 'zod'

/**
 * The 2048 rules both halves agree on: the contract the routes answer with, and the moves that
 * change it — pure, so the backend, the tool and the view cannot disagree about a board.
 *
 * Cells are 0–15, row by row from the top left. One board per chat; either the person or the
 * agent in that chat controls it (`mode`), and only the controller may move.
 */

export const SIZE = 4
export const CELLS = SIZE * SIZE
export const directions = ['up', 'down', 'left', 'right'] as const
export type Direction = (typeof directions)[number]
export const modes = ['user', 'agent'] as const
export type Mode = (typeof modes)[number]

/**
 * Who plays when the board is not the person's (`mode: 'agent'`), from
 * `@localixai/mini-app-sdk/opponent`: the agent in the chat, woken and moving with its tool, or the
 * host's decision model, which the board asks itself one move at a time. Null until the board
 * settles it (the decision model when one can answer, else the agent).
 */
export { OPPONENTS, type Opponent }

/**
 * The most moves one call plays. The agent plans them without seeing the tiles that spawn, so a
 * longer plan is mostly a guess; 32 keeps a call worth making without playing blind for long.
 */
export const MAX_MOVES = 32

const tileSchema = z
  .number()
  .int()
  .min(0)
  .max(131072)
  .refine((value) => value === 0 || (value & (value - 1)) === 0)
const cellIndex = z
  .number()
  .int()
  .min(0)
  .max(CELLS - 1)

/**
 * While the agent holds the board: when it last acted (or was asked), and whether it can answer.
 * Anything that counts ("playing for 12s") is derived from `since` against a clock.
 */
export { agentWaitSchema, type AgentWait }

/** One move as it happened: the direction, and the tile that appeared after it. */
export const stepSchema = z.object({
  direction: z.enum(directions),
  spawn: z.object({ cell: cellIndex, value: z.union([z.literal(2), z.literal(4)]) }),
})
export type Step = z.infer<typeof stepSchema>

/**
 * The moves the last change played, from the board they started on. A batch of agent moves lands
 * in one write, and without this the view saw the board jump by thirty moves; with it, the view
 * replays each move where it happened.
 */
export const turnSchema = z.object({
  from: z.array(tileSchema).length(CELLS),
  steps: z.array(stepSchema).min(1).max(MAX_MOVES),
})

export const gameSchema = z.object({
  id: z.string().min(1),
  board: z.array(tileSchema).length(CELLS),
  mode: z.enum(modes),
  status: z.enum(['playing', 'won', 'over']),
  score: z.number().int().min(0),
  best: z.number().int().min(0),
  moves: z.number().int().min(0),
  lastTurn: turnSchema.nullable(),
  waiting: agentWaitSchema.nullable(),
  /** Who plays in `agent` mode; carried from one game to the next. */
  opponent: opponentSchema,
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

/** A move the rules refuse, in a sentence the person or the agent can act on. */
export class MoveRefused extends Error {
  override name = 'MoveRefused'
}

/** The tile that appears in a free cell after a move: a 2, or one time in ten a 4. */
export function spawnTile(
  board: readonly number[],
  random: () => number,
): { cell: number; value: 2 | 4 } | null {
  const free = board.flatMap((value, cell) => (value === 0 ? [cell] : []))
  if (free.length === 0) return null
  const cell = free[Math.min(free.length - 1, Math.floor(random() * free.length))]!
  return { cell, value: random() < 0.9 ? 2 : 4 }
}

/** `board` with `tile` put down. */
export const place = (board: readonly number[], tile: { cell: number; value: number } | null) =>
  tile ? board.map((value, cell) => (cell === tile.cell ? tile.value : value)) : [...board]

export function newGame(input: {
  id: string
  mode: Mode
  now: string
  best?: number
  opponent?: Opponent | null
  random: () => number
}): Game {
  const empty = Array<number>(CELLS).fill(0)
  const first = place(empty, spawnTile(empty, input.random))
  return {
    id: input.id,
    board: place(first, spawnTile(first, input.random)),
    mode: input.mode,
    status: 'playing',
    score: 0,
    best: input.best ?? 0,
    moves: 0,
    lastTurn: null,
    waiting: null,
    opponent: input.opponent ?? null,
    startedAt: input.now,
  }
}

/** Where one tile went in a move; two tiles with the same `to` merged there. */
export interface Track {
  from: number
  to: number
}

/** The cells of one row or column, in the order its tiles slide towards. */
function lineCells(line: number, direction: Direction): number[] {
  return Array.from({ length: SIZE }, (_, step) => {
    if (direction === 'left') return line * SIZE + step
    if (direction === 'right') return line * SIZE + SIZE - 1 - step
    if (direction === 'up') return step * SIZE + line
    return (SIZE - 1 - step) * SIZE + line
  })
}

/**
 * The board after sliding every tile towards `direction`: each pair of equal neighbours merges
 * once, and `tracks` says where every tile went, so the view can move the tile it already drew.
 */
export function shift(
  board: readonly number[],
  direction: Direction,
): { board: number[]; points: number; merges: number[]; tracks: Track[]; changed: boolean } {
  const next = Array<number>(CELLS).fill(0)
  const merges: number[] = []
  const tracks: Track[] = []
  let points = 0
  for (let line = 0; line < SIZE; line++) {
    const cells = lineCells(line, direction)
    const filled = cells.filter((cell) => board[cell])
    let slot = 0
    for (let index = 0; index < filled.length; index++) {
      const here = filled[index]!
      const after = filled[index + 1]
      const to = cells[slot++]!
      if (after !== undefined && board[here] === board[after]) {
        next[to] = board[here]! * 2
        points += next[to]
        merges.push(to)
        tracks.push({ from: here, to }, { from: after, to })
        index++
      } else {
        next[to] = board[here]!
        tracks.push({ from: here, to })
      }
    }
  }
  return {
    board: next,
    points,
    merges,
    tracks,
    changed: next.some((value, cell) => value !== board[cell]),
  }
}

export const legalDirections = (board: readonly number[]): Direction[] =>
  directions.filter((direction) => shift(board, direction).changed)

/** Won once a 2048 is on the board; over once no direction moves it. */
export const statusOf = (board: readonly number[]): Game['status'] =>
  board.some((value) => value >= 2048) ? 'won' : legalDirections(board).length ? 'playing' : 'over'

/** Whether the agent is the one playing now. */
export const agentPlays = (game: Pick<Game, 'mode' | 'status'> | null): boolean =>
  game?.mode === 'agent' && game.status === 'playing'

/** The wait a person's Stop leaves: whoever plays the board pauses until Continue. */
export const STOPPED_REASON = 'Stopped by you.'

/** Whether a person stopped the play on this board (Continue resumes it). */
export const stopped = (game: Pick<Game, 'waiting'>): boolean =>
  game.waiting?.status === 'unreachable' && game.waiting.reason === STOPPED_REASON

/** Whether the decision model is the one playing now (an `agent` board it holds). */
export const decisionPlays = (game: Pick<Game, 'mode' | 'status' | 'opponent'> | null): boolean =>
  agentPlays(game) && game?.opponent === 'decision'
