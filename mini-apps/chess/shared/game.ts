import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import { z } from 'zod'

import { SIDES, findPlay, other, positionOf, type Ending, type Side } from './position'

/**
 * The game both halves agree on: the contract the routes answer with, and the one function that
 * decides a move — pure, so the backend, the tools and the view cannot disagree about who won.
 *
 * The person plays one colour and the agent in the chat the board belongs to plays the other. One
 * board per chat: the chat is the TABLE, a game is one round at it, and the table keeps the running
 * score. White moves first; the person's colour alternates from game to game, so the agent opens
 * every other one. Status is from the person's side. The rules themselves live behind
 * `position.ts`; this module only decides what a move does to the game.
 */

export { SIDES, type Side } from './position'

export const PLAYERS = ['you', 'agent'] as const
export type Player = (typeof PLAYERS)[number]

/**
 * Who plays the person's opposite colour at this table (`@localixai/mini-app-sdk/opponent`): the
 * agent in the chat, or the host's decision model. The side is the same either way — a move by
 * that colour is the `agent` player's — only who fills it differs.
 */
export { OPPONENTS, type Opponent }

/**
 * While the agent owes a move: when it was asked, and whether it can answer. Everything that counts
 * ("thinking for 12s") is derived from `since` against a clock, never counted in state.
 */
export { agentWaitSchema, type AgentWait }

export const moveSchema = z.object({
  san: z.string().min(2).max(12),
  from: z.string().length(2),
  to: z.string().length(2),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  captured: z.string().optional(),
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

/** The one game at this table — what the mini app keeps, and what every route answers with. */
export const gameSchema = z.object({
  id: z.string().min(1),
  /** Every move played, in order; the position is replayed from them. */
  moves: z.array(moveSchema),
  /** The person's colour — the next game gives them the other one. */
  you: z.enum(SIDES),
  status: z.enum(['playing', 'won', 'lost', 'draw']),
  /** How the game ended: by the rules (`position.ts`), or because the agent resigned. */
  ending: z
    .enum(['checkmate', 'stalemate', 'threefold', 'insufficient', 'fifty-move', 'resign'])
    .nullable(),
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
    moves: [],
    you: input.you,
    status: 'playing',
    ending: null,
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

/** The side to move, derived from how many moves were played. */
export const turnOf = (game: Pick<Game, 'moves'>): Side =>
  game.moves.length % 2 === 0 ? 'white' : 'black'

/** Whether the agent is the one to move now. */
export const owesAgentMove = (game: Pick<Game, 'status' | 'moves' | 'you'> | null): boolean =>
  game?.status === 'playing' && turnOf(game) !== game.you

/** The position of `game` — the board, the legal moves, check and how it ended. */
export const positionOfGame = (game: Pick<Game, 'moves'>) =>
  positionOf(game.moves.map((move) => move.san))

const scored = (record: GameRecord, status: Game['status']): GameRecord =>
  status === 'playing' ? record : { ...record, [status]: record[status] + 1 }

const DRAWN: readonly Ending[] = ['stalemate', 'threefold', 'insufficient', 'fifty-move']

/**
 * The game after `by` plays the move `text` names (SAN or coordinates), or a {@link MoveRefused}
 * saying why there is none.
 */
export function applyMove(game: Game, text: string, by: Player, now: string): Game {
  const side = by === 'you' ? game.you : other(game.you)
  if (game.status !== 'playing') throw new MoveRefused('This game is over. Start a new one.')
  if (turnOf(game) !== side)
    throw new MoveRefused(
      by === 'you'
        ? 'Wait for the agent’s move.'
        : `It is the user’s turn (${game.you}). The board wakes you when they have moved.`,
    )
  const before = positionOfGame(game)
  const play = findPlay(before.legal, text)
  if (!play)
    throw new MoveRefused(
      `${text.trim() || 'That'} is not a legal move here. Legal moves: ${before.legal.map((p) => p.san).join(', ')}.`,
    )

  const moves = [...game.moves, { ...play, by, at: now }]
  const after = positionOf(moves.map((move) => move.san))
  const status: Game['status'] =
    after.ending === 'checkmate'
      ? side === game.you
        ? 'won'
        : 'lost'
      : after.ending && DRAWN.includes(after.ending)
        ? 'draw'
        : 'playing'
  return {
    ...game,
    moves,
    status,
    ending: after.ending,
    // The agent's move answers whatever it was asked.
    waiting: by === 'agent' ? null : game.waiting,
    record: scored(game.record, status),
  }
}

/** How a game ended, the rules' endings and a resignation. */
export type GameEnding = NonNullable<Game['ending']>

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
