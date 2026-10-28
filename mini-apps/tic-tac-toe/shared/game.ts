import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import { z } from 'zod'

/**
 * The game both halves agree on: the contract the routes answer with, and the rules that decide
 * every move — pure, so the backend, the tools and the view cannot disagree about who won.
 *
 * The person plays X; the agent in the chat the board belongs to plays O. One board per chat: the
 * chat is the TABLE, a game is one round at it, and the table keeps the running score. Cells are
 * indexed 0–8 here and numbered 1–9 wherever a person or the agent reads them, row by row from the
 * top left.
 */

export const MARKS = ['X', 'O'] as const
export type Mark = (typeof MARKS)[number]
export type Cell = Mark | null

export const PLAYERS = ['you', 'agent'] as const
export type Player = (typeof PLAYERS)[number]

/**
 * Who plays O at this table (`@localixai/mini-app-sdk/opponent`): the agent in the chat, or the
 * host's decision model. The side is the same either way — a move by O is the `agent` player's —
 * only who fills it differs.
 */
export { OPPONENTS, type Opponent }

const cellIndex = z.number().int().min(0).max(8)

/**
 * While the agent owes a move: when it was asked, and whether it can answer. Everything that counts
 * ("thinking for 12s") is derived from `since` against a clock, never counted in state.
 */
export { agentWaitSchema, type AgentWait }

export const moveSchema = z.object({
  cell: cellIndex,
  mark: z.enum(MARKS),
  by: z.enum(PLAYERS),
  at: z.string(),
})
export type Move = z.infer<typeof moveSchema>

/** The score at this table, from the person's side — carried from one game to the next. */
export const recordSchema = z.object({
  won: z.number().int().min(0),
  lost: z.number().int().min(0),
  draw: z.number().int().min(0),
})
export type GameRecord = z.infer<typeof recordSchema>
export const EMPTY_RECORD: GameRecord = { won: 0, lost: 0, draw: 0 }

/** The one game at this table — what the mini app keeps, and what every route answers with. */
export const gameSchema = z.object({
  id: z.string().min(1),
  board: z.array(z.enum(MARKS).nullable()).length(9),
  /** Whose move it is; kept after the end, where nothing reads it. */
  turn: z.enum(MARKS),
  /** Who opened this game — the next one opens with the other side. */
  first: z.enum(MARKS),
  /** From the person's side. */
  status: z.enum(['playing', 'won', 'lost', 'draw']),
  /** The three cells of the winning line. */
  line: z.array(cellIndex).length(3).nullable(),
  moves: z.array(moveSchema).max(9),
  waiting: agentWaitSchema.nullable(),
  record: recordSchema,
  /** Who plays O; carried from one game to the next; null until the table settles it. */
  opponent: opponentSchema,
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

const CELL_NAMES = [
  'top left',
  'top',
  'top right',
  'left',
  'centre',
  'right',
  'bottom left',
  'bottom',
  'bottom right',
]

/** "top left", "centre" — where a cell is. */
export const placeName = (cell: number): string => CELL_NAMES[cell] ?? `cell ${cell + 1}`

/** "the centre (cell 5)" — how a cell reads in a sentence. */
export const cellName = (cell: number): string => `the ${placeName(cell)} (cell ${cell + 1})`

export const freeCells = (board: readonly Cell[]): number[] =>
  board.flatMap((mark, cell) => (mark === null ? [cell] : []))

export function winnerOf(board: readonly Cell[]): { mark: Mark; line: number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line
    const mark = board[a]
    if (mark && mark === board[b] && mark === board[c]) return { mark, line: [...line] }
  }
  return null
}

export function newGame(input: {
  id: string
  first: Mark
  now: string
  record?: GameRecord
  opponent?: Opponent | null
}): Game {
  return {
    id: input.id,
    board: Array.from({ length: 9 }, () => null),
    turn: input.first,
    first: input.first,
    status: 'playing',
    line: null,
    moves: [],
    waiting: null,
    record: input.record ?? EMPTY_RECORD,
    opponent: input.opponent ?? null,
    startedAt: input.now,
  }
}

/** A move the rules refuse, in a sentence the person or the agent can act on. */
export class MoveRefused extends Error {
  override name = 'MoveRefused'
}

/** The mark each player puts down. */
export const markOf = (by: Player): Mark => (by === 'you' ? 'X' : 'O')

/** Whether the agent is the one to move now. */
export const owesAgentMove = (game: Pick<Game, 'status' | 'turn'> | null): boolean =>
  game?.status === 'playing' && game.turn === 'O'

/** The score after a game that ended `status`. */
export const scored = (record: GameRecord, status: Game['status']): GameRecord =>
  status === 'playing' ? record : { ...record, [status]: record[status] + 1 }

/** The game after one move, or a {@link MoveRefused} saying why there is none. */
export function applyMove(game: Game, cell: number, by: Player, now: string): Game {
  const mark = markOf(by)
  if (game.status !== 'playing') throw new MoveRefused('This game is over. Start a new one.')
  if (game.turn !== mark)
    throw new MoveRefused(
      mark === 'O'
        ? 'It is the user’s turn (X). The board wakes you when they have moved.'
        : 'Wait for the agent’s move.',
    )
  if (!Number.isInteger(cell) || cell < 0 || cell > 8)
    throw new MoveRefused('Choose a cell from 1 to 9.')
  if (game.board[cell] !== null) throw new MoveRefused(`${capital(cellName(cell))} is taken.`)
  const board = game.board.map((current, index) => (index === cell ? mark : current))
  const won = winnerOf(board)
  const full = freeCells(board).length === 0
  const status = won ? (won.mark === 'X' ? 'won' : 'lost') : full ? 'draw' : 'playing'
  return {
    ...game,
    board,
    turn: mark === 'X' ? 'O' : 'X',
    status,
    line: won?.line ?? null,
    moves: [...game.moves, { cell, mark, by, at: now }],
    // The agent's move answers whatever it was asked.
    waiting: by === 'agent' ? null : game.waiting,
    record: scored(game.record, status),
  }
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
