import { randomUUID } from 'node:crypto'
import { createTurnTable, seal, type TurnTableHosts } from '@localixai/mini-app-sdk/backend'

import {
  applyMove,
  gameSchema,
  MoveRefused,
  newGame,
  nextRound,
  owesAgentMove,
  type Game,
  type Move,
  type Player,
} from '../shared/game'
import { ANSWER_TOOLS, askForMove, roundKey, type ChatRef } from './ask-agent'
import { askDecision } from './ask-decision'

/**
 * THE TABLE AT EACH CHAT, and every way it changes.
 *
 * One table per chat session, kept in that session's own folder; the turn-taking — who is asked
 * for the agent's move, once per round, and how its answer lands — is the SDK's
 * `createTurnTable`, shared by every game with the agent as its opponent.
 *
 * Every move is SEALED here, the moment it arrives (`seal`: a fresh salt and its digest), so the
 * stored round already holds the commitment the other side will be shown. A PERSON's action may
 * leave the agent owing a move, so it is asked (`askAgent`); the AGENT acts through its tools and
 * is never asked for anything.
 *
 * Who fills the agent's side depends on the table's `opponent`: the agent is woken and moves with
 * its tool later; the decision model is asked — from the finished rounds only — after the
 * person's request has answered with the model thinking, and its move is sealed and played when
 * it lands, reaching the view through the store feed.
 */
export function createGameService(
  input: TurnTableHosts & { now?: () => string; newId?: () => string },
) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const play = (game: Game, player: Player, move: Move, at: string) =>
    applyMove(game, seal(move, player, at), at)
  const table = createTurnTable({
    ...input,
    miniApp: 'rock-paper-scissors',
    noun: 'table',
    now,
    schema: gameSchema,
    initial: () => newGame({ id: newId(), roundId: newId(), first: 'you', now: now() }),
    owes: owesAgentMove,
    key: roundKey,
    // The answer is recorded only while the round still waits for it.
    live: owesAgentMove,
    agentTurn: (game) => ({ message: askForMove(game), tools: ANSWER_TOOLS }),
    askDecision,
    playDecision: (game, answer: { move: Move }, at) => play(game, 'agent', answer.move, at),
    refuse: (message) => new MoveRefused(message),
  })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: table.settled,
    read: table.read,

    // ── What a person does in the view ─────────────────────────────────────────────────────
    personMove: (chat: ChatRef, move: Move) =>
      table.personTurn(chat, (game, at) => play(game, 'you', move, at)),
    /** The next round, opened by `first` — else by whoever did not open the last. */
    nextRound: (chat: ChatRef, first?: Player) =>
      table.personTurn(chat, (game, at) => nextRound(game, { id: newId(), now: at, first })),
    /** Ask the agent again for the move it owes. */
    remind: table.remind,
    /** Who fills the other side from now on; a move it owes is asked of the new opponent at once. */
    setOpponent: table.setOpponent,

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /** `answered` says whether the move answered the table's own wake. */
    agentMove: (chat: ChatRef, move: Move) =>
      table.agentTurn(chat, (game, at) => play(game, 'agent', move, at)),
    /**
     * The next round, `first` opening. Against the decision model the user opens: only a person's
     * action asks that model, and a tool call is never one.
     */
    agentNextRound: (chat: ChatRef, first: Player) =>
      table.update(chat, (game, at) =>
        nextRound(game, {
          id: newId(),
          now: at,
          first: game.opponent === 'decision' ? 'you' : first,
        }),
      ),
  }
}

export type GameService = ReturnType<typeof createGameService>
