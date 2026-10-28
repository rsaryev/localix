import { randomUUID } from 'node:crypto'

import {
  applyMove,
  gameSchema,
  MoveRefused,
  newGame,
  owesAgentMove,
  resign,
  type Game,
  type Side,
} from '../shared/game'
import { other } from '../shared/position'
import { ANSWER_TOOLS, askForMove, positionKey, type ChatRef } from './ask-agent'
import { askDecision } from './ask-decision'
import { createTurnTable, type TurnTableHosts } from '@localixai/mini-app-sdk/backend'

/**
 * THE GAME AT EACH CHAT'S TABLE, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder; the turn-taking — who is asked
 * for the other colour's move, once per position, and how its answer lands — is the SDK's
 * `createTurnTable`, shared by every game with the agent as its opponent. What is chess's own is
 * here: what a move is, and what the next game at the table looks like.
 *
 * Who answers the other colour depends on the table's `opponent`: the agent is woken and moves
 * with its tool later; the decision model is asked after the person's request has answered with
 * the model thinking, and its move lands through the store feed. Either way the person's own move
 * is written and returned first, so the board shows it at once.
 */
export function createGameService(
  input: TurnTableHosts & { now?: () => string; newId?: () => string },
) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const table = createTurnTable({
    ...input,
    miniApp: 'chess',
    noun: 'board',
    now,
    schema: gameSchema,
    initial: () => newGame({ id: newId(), you: 'white', now: now() }),
    owes: owesAgentMove,
    key: positionKey,
    live: (game: Game) => game.status === 'playing',
    agentTurn: (game) => ({ message: askForMove(game), tools: ANSWER_TOOLS }),
    askDecision,
    playDecision: (game, answer: { move: string }, at) => applyMove(game, answer.move, 'agent', at),
    refuse: (message) => new MoveRefused(message),
  })

  /** The next game at this table: the person takes the other colour, and the score carries over. */
  const nextGame = (game: Game, at: string, you?: Side) =>
    newGame({
      id: newId(),
      you: you ?? other(game.you),
      now: at,
      record: game.record,
      opponent: game.opponent,
    })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: table.settled,
    read: table.read,

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Play the move `move` names — SAN or coordinates ("e2e4", "e7e8n"). */
    personMove: (chat: ChatRef, move: string) =>
      table.personTurn(chat, (game, at) => applyMove(game, move, 'you', at)),
    /** The next game at this table, the person on `you` — else on the other colour. */
    newGame: (chat: ChatRef, you?: Side) =>
      table.personTurn(chat, (game, at) => nextGame(game, at, you)),
    /** Ask the agent again for the move it owes. */
    remind: table.remind,
    /** Who plays the other colour from now on; a move it owes is asked of the new opponent at once. */
    setOpponent: table.setOpponent,

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Play the move `move` names. `answered` says whether the move answered the board's own
     * question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentMove: (chat: ChatRef, move: string) =>
      table.agentTurn(chat, (game, at) => applyMove(game, move, 'agent', at)),
    /**
     * The next game at this table, the user on `you`. Against the decision model the user plays
     * white and opens: only a person's action asks that model, and a tool call is never one.
     */
    agentNewGame: (chat: ChatRef, you: Side) =>
      table.update(chat, (game, at) =>
        nextGame(game, at, game.opponent === 'decision' ? 'white' : you),
      ),
    /** Resign the game at this table: the user wins. Not the agent's to do for the decision model. */
    agentResign: (chat: ChatRef) => table.agentUpdate(chat, (game) => resign(game)),
  }
}

export type GameService = ReturnType<typeof createGameService>
