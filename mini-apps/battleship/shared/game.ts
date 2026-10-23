import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import { z } from 'zod'

import {
  SIZE,
  allSunk,
  cellName,
  isLegalFleet,
  knownCells,
  shotResult,
  sunkShips,
  type Ship,
} from './rules'

/**
 * The game both halves agree on, and the one function that decides a shot — pure, so the backend,
 * the tools and the view cannot disagree about a result.
 *
 * Battleship is the one game here with HIDDEN information, and that shapes the contract: the full
 * {@link Game} lives only on the server. Nobody outside it ever receives it whole — the view gets
 * {@link PlayerView} (its own fleet, and of the agent's only what its shots revealed), and the
 * agent gets text built from the same projection for its side (`describe.ts`). A fleet that is
 * never sent cannot leak through a devtools panel, a message context or a tool result.
 */

export const PLAYERS = ['you', 'agent'] as const
export type Player = (typeof PLAYERS)[number]
export const opponentOf = (player: Player): Player => (player === 'you' ? 'agent' : 'you')

/**
 * Who fires from the agent's side at this table (`@localixai/mini-app-sdk/opponent`): the agent in
 * the chat, or the host's decision model. The side is the same either way — a shot from it is the
 * `agent` player's — only who aims it differs.
 */
export { OPPONENTS, type Opponent }

const cell = z
  .number()
  .int()
  .min(0)
  .max(SIZE * SIZE - 1)
const shipSchema = z.object({ cells: z.array(cell).min(1).max(4) })
const fleetSchema = z.array(shipSchema).refine(isLegalFleet, 'Not a legal fleet')

/**
 * While the agent owes a shot: when it was asked, and whether it can answer. Everything that
 * counts ("thinking for 12s") is derived from `since` against a clock, never counted in state.
 */
export { agentWaitSchema, type AgentWait }

export const shotSchema = z.object({
  by: z.enum(PLAYERS),
  cell,
  result: z.enum(['miss', 'hit', 'sunk']),
  at: z.string(),
})
export type Shot = z.infer<typeof shotSchema>

/** The score at this table, from the person's side — carried from one game to the next. */
export const recordSchema = z.object({
  won: z.number().int().min(0),
  lost: z.number().int().min(0),
})
export type GameRecord = z.infer<typeof recordSchema>
export const EMPTY_RECORD: GameRecord = { won: 0, lost: 0 }

/** The whole game, server-side only. */
export const gameSchema = z.object({
  id: z.string().min(1),
  /** Each side's own fleet. */
  fleets: z.object({ you: fleetSchema, agent: fleetSchema }),
  /** Whose shot it is; kept after the end, where nothing reads it. */
  turn: z.enum(PLAYERS),
  /** Who fired first — the next game starts with the other side. */
  first: z.enum(PLAYERS),
  /** From the person's side. */
  status: z.enum(['playing', 'won', 'lost']),
  /** Every shot, in order; each side's shots at the other are derived from it. */
  shots: z.array(shotSchema).max(SIZE * SIZE * 2),
  waiting: agentWaitSchema.nullable(),
  record: recordSchema,
  /** Who fires from the agent's side; carried from one game to the next; null until settled. */
  opponent: opponentSchema,
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

/** The cells `player` has fired at, in order. */
export const shotsBy = (game: Pick<Game, 'shots'>, player: Player) =>
  game.shots.filter((shot) => shot.by === player).map((shot) => shot.cell)

export function newGame(input: {
  id: string
  first: Player
  fleets: { you: Ship[]; agent: Ship[] }
  now: string
  record?: GameRecord
  opponent?: Opponent | null
}): Game {
  return {
    id: input.id,
    fleets: input.fleets,
    turn: input.first,
    first: input.first,
    status: 'playing',
    shots: [],
    waiting: null,
    record: input.record ?? EMPTY_RECORD,
    opponent: input.opponent ?? null,
    startedAt: input.now,
  }
}

/** A shot the rules refuse, in a sentence the person or the agent can act on. */
export class ShotRefused extends Error {
  override name = 'ShotRefused'
}

/** Whether the agent is the one to fire now. */
export const owesAgentShot = (game: Pick<Game, 'status' | 'turn'> | null): boolean =>
  game?.status === 'playing' && game.turn === 'agent'

/** The game after `by` fires at `target`, or a {@link ShotRefused} saying why it may not. */
export function applyShot(game: Game, by: Player, target: number, now: string): Game {
  if (game.status !== 'playing') throw new ShotRefused('This game is over. Start a new one.')
  if (game.turn !== by)
    throw new ShotRefused(
      by === 'you'
        ? 'Wait for the agent’s shot.'
        : 'It is the user’s turn. The board wakes you when they have fired.',
    )
  if (!Number.isInteger(target) || target < 0 || target >= SIZE * SIZE)
    throw new ShotRefused('Choose a cell from A1 to J10.')
  const fleet = game.fleets[opponentOf(by)]
  const fired = shotsBy(game, by)
  if (knownCells(fleet, fired).has(target))
    throw new ShotRefused(`${cellName(target)} is already known — choose another cell.`)

  const result = shotResult(fleet, fired, target)
  const won = result === 'sunk' && allSunk(fleet, [...fired, target])
  // A hit earns another shot; only a miss passes the turn.
  const turn = result === 'miss' ? opponentOf(by) : by
  const status = won ? (by === 'you' ? 'won' : 'lost') : 'playing'
  return {
    ...game,
    turn,
    status,
    shots: [...game.shots, { by, cell: target, result, at: now }],
    // The wait ends when the agent no longer owes a shot.
    waiting: turn === 'agent' && !won ? game.waiting : null,
    record:
      status === 'playing' ? game.record : { ...game.record, [status]: game.record[status] + 1 },
  }
}

/**
 * The game as ONE side may see it: its own fleet whole, the other side's only as far as its
 * shots revealed — sunk ships, and every ship once the game is over.
 */
export const playerViewSchema = z.object({
  id: z.string(),
  turn: z.enum(PLAYERS),
  first: z.enum(PLAYERS),
  status: z.enum(['playing', 'won', 'lost']),
  shots: z.array(shotSchema),
  waiting: agentWaitSchema.nullable(),
  record: recordSchema,
  opponent: opponentSchema,
  startedAt: z.string(),
  /** The viewer's own fleet. */
  fleet: z.array(shipSchema),
  /** The opponent's ships the viewer may see. */
  enemySeen: z.array(shipSchema),
})
export type PlayerView = z.infer<typeof playerViewSchema>

export function viewFor(game: Game, viewer: Player): PlayerView {
  const enemy = game.fleets[opponentOf(viewer)]
  return {
    id: game.id,
    turn: game.turn,
    first: game.first,
    status: game.status,
    shots: game.shots,
    waiting: game.waiting,
    record: game.record,
    opponent: game.opponent,
    startedAt: game.startedAt,
    fleet: game.fleets[viewer],
    enemySeen: game.status === 'playing' ? sunkShips(enemy, shotsBy(game, viewer)) : enemy,
  }
}
