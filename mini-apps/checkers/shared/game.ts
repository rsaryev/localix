import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import { z } from 'zod'

import { findPlay, moveName } from './notation'
import { SIDES, applyPlay, legalMoves, openingBoard, other, type Play, type Side } from './rules'

/**
 * The game both halves agree on: the contract the routes answer with, and the one function that
 * decides a move — pure, so the backend, the tools and the view cannot disagree about who won.
 *
 * The person plays one colour and the agent in the chat the board belongs to plays the other. One
 * board per chat: the chat is the TABLE, a game is one round at it, and the table keeps the running
 * score. White always moves first; the person's colour alternates from game to game, so the agent
 * opens every other one. Status is from the person's side.
 */

export { SIDES, type Side } from './rules'

export const PLAYERS = ['you', 'agent'] as const

/**
 * Who plays the person's opposite colour at this table (`@localixai/mini-app-sdk/opponent`): the
 * agent in the chat, or the host's decision model. The side is the same either way — a move from
 * it is the `agent` player's — only who fills it differs.
 */
export { OPPONENTS, type Opponent }

/**
 * Russian draughts ends in a draw after fifteen moves each with no capture and no man moved — only
 * kings shuffling. Counted in plies.
 */
export const QUIET_DRAW_PLIES = 30

const squareIndex = z.number().int().min(0).max(63)

/**
 * While the agent owes a move: when it was asked, and whether it can answer. Everything that counts
 * ("thinking for 12s") is derived from `since` against a clock, never counted in state.
 */
export { agentWaitSchema, type AgentWait }

export const pieceSchema = z.object({ side: z.enum(SIDES), king: z.boolean() })

export const moveSchema = z.object({
  from: squareIndex,
  path: z.array(squareIndex).min(1),
  captured: z.array(squareIndex),
  crowned: z.boolean(),
  side: z.enum(SIDES),
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

/** The score after a game that ended `status`. */
export const scored = (record: GameRecord, status: Game['status']): GameRecord =>
  status === 'playing' ? record : { ...record, [status]: record[status] + 1 }

/** The one game at this table — what the mini app keeps, and what every route answers with. */
export const gameSchema = z.object({
  id: z.string().min(1),
  board: z.array(pieceSchema.nullable()).length(64),
  /** Whose move it is; kept after the end, where nothing reads it. */
  turn: z.enum(SIDES),
  /** The person's colour — the next game gives them the other one. */
  you: z.enum(SIDES),
  status: z.enum(['playing', 'won', 'lost', 'draw']),
  /** How the game ended: the loser had no move left, the quiet-move draw, or the agent resigned. */
  ending: z.enum(['no-moves', 'quiet', 'resign']).nullable(),
  /** Plies since the last capture or man move, toward {@link QUIET_DRAW_PLIES}. */
  quiet: z.number().int().min(0),
  moves: z.array(moveSchema),
  waiting: agentWaitSchema.nullable(),
  record: recordSchema,
  /** Who plays the other colour; carried from one game to the next; null until the table settles it. */
  opponent: opponentSchema,
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

export function newGame(input: {
  id: string
  you: Side
  now: string
  record?: GameRecord
  opponent?: Opponent | null
}): Game {
  return {
    id: input.id,
    board: openingBoard(),
    turn: 'white',
    you: input.you,
    status: 'playing',
    ending: null,
    quiet: 0,
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

/** The colour each player moves. */
export const sideOf = (game: Pick<Game, 'you'>, by: Move['by']): Side =>
  by === 'you' ? game.you : other(game.you)

/** The legal moves of whoever is to play — none once the game is over. */
export const movesNow = (game: Game): Play[] =>
  game.status === 'playing' ? legalMoves(game.board, game.turn) : []

/** Whether the agent is the one to move now. */
export const owesAgentMove = (game: Pick<Game, 'status' | 'turn' | 'you'> | null): boolean =>
  game?.status === 'playing' && game.turn !== game.you

/**
 * The game after `by` plays the move visiting `squares`, or a {@link MoveRefused} saying why
 * there is none.
 */
export function applyMove(
  game: Game,
  squares: readonly number[],
  by: Move['by'],
  now: string,
): Game {
  const side = sideOf(game, by)
  if (game.status !== 'playing') throw new MoveRefused('This game is over. Start a new one.')
  if (game.turn !== side)
    throw new MoveRefused(
      by === 'you'
        ? 'Wait for the agent’s move.'
        : `It is the user’s turn (${game.you}). The board wakes you when they have moved.`,
    )
  const legal = legalMoves(game.board, side)
  const play = findPlay(legal, squares)
  if (!play) throw new MoveRefused(refusal(legal))

  const board = applyPlay(game.board, play)
  const turn = other(side)
  const manMoved = !game.board[play.from]!.king
  const quiet = play.captured.length > 0 || manMoved ? 0 : game.quiet + 1
  const stuck = legalMoves(board, turn).length === 0
  const drawn = !stuck && quiet >= QUIET_DRAW_PLIES
  const status = stuck ? (side === game.you ? 'won' : 'lost') : drawn ? 'draw' : 'playing'
  return {
    ...game,
    board,
    turn,
    status,
    ending: stuck ? 'no-moves' : drawn ? 'quiet' : null,
    quiet,
    moves: [...game.moves, { ...play, side, by, at: now }],
    // The agent's move answers whatever it was asked.
    waiting: by === 'agent' ? null : game.waiting,
    record: scored(game.record, status),
  }
}

/**
 * The game after the agent resigns: the user wins, whoever's turn it is — a player may resign at
 * any moment, as over a real board. The score counts it like any other win.
 */
export function resign(game: Game): Game {
  if (game.status !== 'playing') throw new MoveRefused('This game is over already.')
  return {
    ...game,
    status: 'won',
    ending: 'resign',
    waiting: null,
    record: scored(game.record, 'won'),
  }
}

function refusal(legal: readonly Play[]): string {
  const names = legal.map(moveName).join(', ')
  if (legal[0]?.captured.length) return `A capture is compulsory. Legal moves: ${names}.`
  return `That is not a legal move. Legal moves: ${names}.`
}
