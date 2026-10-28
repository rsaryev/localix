import { agentWaitSchema, type AgentWait } from '@localixai/mini-app-sdk/agent-wait'
import { OPPONENTS, opponentSchema, type Opponent } from '@localixai/mini-app-sdk/opponent'
import {
  revealSealed,
  sealedSchema,
  sealedView,
  sealedViewSchema,
  type Sealed,
} from '@localixai/mini-app-sdk/sealed'
import { z } from 'zod'

/**
 * The game both halves agree on: what the backend keeps, what each player may SEE of it, and the
 * rules — pure, so the routes, the tools and the view cannot disagree about who won.
 *
 * One table per chat: the person against the agent in that chat. A round is two sealed moves. The
 * side that moves first commits a {@link Sealed} move the other cannot read — only its digest —
 * and the round reveals both once the second has moved, so neither side can answer what it saw.
 * Who opens alternates from round to round.
 *
 * The whole {@link Game} holds both moves in the clear and never leaves the backend. Everything
 * else — every route answer, every tool result, the wake, the chat context — is built from
 * {@link viewFor}, the one place that decides what a player may see.
 */

export const MOVES = ['rock', 'paper', 'scissors'] as const
export type Move = (typeof MOVES)[number]
export const moveSchema = z.enum(MOVES)

export const PLAYERS = ['you', 'agent'] as const
export type Player = (typeof PLAYERS)[number]

export { agentWaitSchema, type AgentWait }

/**
 * Who fills the `agent` side at this table (`@localixai/mini-app-sdk/opponent`): the agent in the
 * chat, or the host's decision model. The side — its sealed move, its side of the score — is the
 * same either way; only who chooses differs.
 */
export { OPPONENTS, type Opponent }

/** From the person's side, like the score. */
export const outcomeSchema = z.enum(['won', 'lost', 'draw'])
export type Outcome = z.infer<typeof outcomeSchema>

export const roundSchema = z.object({
  id: z.string().min(1),
  /** 1 for the first round at this table. */
  number: z.number().int().min(1),
  first: z.enum(PLAYERS),
  you: sealedSchema.nullable(),
  agent: sealedSchema.nullable(),
  /** Set when both moves are in, and both are revealed at that moment. */
  outcome: outcomeSchema.nullable(),
  startedAt: z.string(),
})
export type Round = z.infer<typeof roundSchema>

export const recordSchema = z.object({
  won: z.number().int().min(0),
  lost: z.number().int().min(0),
  draw: z.number().int().min(0),
})
export type GameRecord = z.infer<typeof recordSchema>
export const EMPTY_RECORD: GameRecord = { won: 0, lost: 0, draw: 0 }

/** How many finished rounds the table remembers. */
export const HISTORY_LIMIT = 10

/** The table as the backend keeps it — both moves in the clear. Never sent to anyone whole. */
export const gameSchema = z.object({
  id: z.string().min(1),
  round: roundSchema,
  /** Finished rounds, newest last, the current one included once it is revealed. */
  history: z.array(roundSchema).max(HISTORY_LIMIT),
  waiting: agentWaitSchema.nullable(),
  record: recordSchema,
  /** Who plays the other side; carried from round to round; null until the table settles it. */
  opponent: opponentSchema,
  startedAt: z.string(),
})
export type Game = z.infer<typeof gameSchema>

/** One round as one player sees it: their own move, and the other's commitment. */
export const roundViewSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  first: z.enum(PLAYERS),
  mine: moveSchema.nullable(),
  theirs: sealedViewSchema.nullable(),
  outcome: outcomeSchema.nullable(),
})
export type RoundView = z.infer<typeof roundViewSchema>

/** The table as one player may see it — what the routes answer and every text is built from. */
export const playerViewSchema = z.object({
  id: z.string(),
  viewer: z.enum(PLAYERS),
  round: roundViewSchema,
  history: z.array(roundViewSchema),
  waiting: agentWaitSchema.nullable(),
  /** From the person's side, whoever is looking. */
  record: recordSchema,
  opponent: opponentSchema,
})
export type PlayerView = z.infer<typeof playerViewSchema>

export const opponentOf = (player: Player): Player => (player === 'you' ? 'agent' : 'you')

/** A move the rules refuse, in a sentence the person or the agent can act on. */
export class MoveRefused extends Error {
  override name = 'MoveRefused'
}

const BEATS: Record<Move, Move> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }

/** The person's outcome when they play `you` against `agent`. */
export function outcomeOf(you: Move, agent: Move): Outcome {
  if (you === agent) return 'draw'
  return BEATS[you] === agent ? 'won' : 'lost'
}

export const isMove = (value: string): value is Move => (MOVES as readonly string[]).includes(value)

export function newRound(input: { id: string; number: number; first: Player; now: string }): Round {
  return { ...input, you: null, agent: null, outcome: null, startedAt: input.now }
}

export function newGame(input: {
  id: string
  roundId: string
  first: Player
  now: string
  opponent?: Opponent | null
}): Game {
  return {
    id: input.id,
    round: newRound({ id: input.roundId, number: 1, first: input.first, now: input.now }),
    history: [],
    waiting: null,
    record: EMPTY_RECORD,
    opponent: input.opponent ?? null,
    startedAt: input.now,
  }
}

/** Whether `player` may commit now: the round is open, they have not, and it is their turn. */
export function mayMove(round: Round, player: Player): boolean {
  if (round.outcome !== null || round[player] !== null) return false
  return round.first === player || round[opponentOf(player)] !== null
}

/** Whether the agent is the one to move now. */
export const owesAgentMove = (game: Pick<Game, 'round'> | null): boolean =>
  game !== null && mayMove(game.round, 'agent')

/** The same for a view, which carries no moves the viewer may not see. */
export function viewOwesAgentMove(view: PlayerView | null): boolean {
  if (view?.round.outcome !== null) return false
  const agentMoved = view.viewer === 'agent' ? view.round.mine !== null : view.round.theirs !== null
  const youMoved = view.viewer === 'you' ? view.round.mine !== null : view.round.theirs !== null
  return !agentMoved && (view.round.first === 'agent' || youMoved)
}

/**
 * The table after `sealed.owner` commits — revealed and scored when it was the second move — or a
 * {@link MoveRefused} saying why not. The move arrives already sealed: sealing needs the backend's
 * randomness, and these rules also run in the view.
 */
export function applyMove(game: Game, sealed: Sealed, now: string): Game {
  const player = sealed.owner as Player
  if (!(PLAYERS as readonly string[]).includes(player))
    throw new MoveRefused('Only the person and the agent play at this table.')
  if (!isMove(sealed.value)) throw new MoveRefused('Choose rock, paper or scissors.')
  const round = game.round
  if (round.outcome !== null) throw new MoveRefused('This round is over. Start the next one.')
  if (round[player] !== null)
    throw new MoveRefused(
      player === 'agent'
        ? 'Your move for this round is already sealed.'
        : 'You already chose this round.',
    )
  if (!mayMove(round, player))
    throw new MoveRefused(
      player === 'agent'
        ? 'The user opens this round. The board wakes you after they have chosen.'
        : 'Wait for the agent to seal its move.',
    )
  const committed: Round = { ...round, [player]: sealed }
  const waiting = player === 'agent' ? null : game.waiting
  if (!committed.you || !committed.agent) return { ...game, round: committed, waiting }
  const outcome = outcomeOf(committed.you.value as Move, committed.agent.value as Move)
  const revealed: Round = {
    ...committed,
    you: revealSealed(committed.you, now),
    agent: revealSealed(committed.agent, now),
    outcome,
  }
  return {
    ...game,
    round: revealed,
    history: [...game.history, revealed].slice(-HISTORY_LIMIT),
    waiting,
    record: { ...game.record, [outcome]: game.record[outcome] + 1 },
  }
}

/** The next round at this table: the other side opens unless `first` says who. */
export function nextRound(game: Game, input: { id: string; now: string; first?: Player }): Game {
  const first = input.first ?? opponentOf(game.round.first)
  return {
    ...game,
    round: newRound({ id: input.id, number: game.round.number + 1, first, now: input.now }),
    waiting: null,
  }
}

function roundFor(round: Round, viewer: Player): RoundView {
  const mine = round[viewer]
  const theirs = round[opponentOf(viewer)]
  return {
    id: round.id,
    number: round.number,
    first: round.first,
    mine: mine ? (mine.value as Move) : null,
    theirs: theirs ? sealedView(theirs) : null,
    outcome: round.outcome,
  }
}

/** What `viewer` may see: their own moves, and of the other's only what has been revealed. */
export function viewFor(game: Game, viewer: Player): PlayerView {
  return {
    id: game.id,
    viewer,
    round: roundFor(game.round, viewer),
    history: game.history.map((round) => roundFor(round, viewer)),
    waiting: game.waiting,
    record: game.record,
    opponent: game.opponent,
  }
}

/** Whether the viewer may commit now, judged from what they can see. */
export function viewerMayMove(view: PlayerView | null): boolean {
  if (view?.round.outcome !== null || view.round.mine !== null) return false
  return view.round.first === view.viewer || view.round.theirs !== null
}

/** The other side's move once revealed, else null. */
export const theirMove = (round: RoundView): Move | null =>
  round.theirs?.revealed ? (round.theirs.value as Move) : null
