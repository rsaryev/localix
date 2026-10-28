import { randomUUID } from 'node:crypto'

import {
  applyMove,
  gameSchema,
  MoveRefused,
  newGame,
  owesAgentMove,
  type Game,
  type Mark,
} from '../shared/game'
import { ANSWER_TOOLS, askForMove, positionKey, type ChatRef } from './ask-agent'
import { askDecision } from './ask-decision'
import { createTurnTable, type TurnTableHosts } from '@localixai/mini-app-sdk/backend'

/**
 * THE GAME AT EACH CHAT'S TABLE, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder; the turn-taking — who is asked
 * for O's move, once per position, and how its answer lands — is the SDK's `createTurnTable`,
 * shared by every game with the agent as its opponent. What is tic-tac-toe's own is here: what a
 * move is, and who opens the next game at the table.
 *
 * Who answers O depends on the table's `opponent`: the agent is woken and moves with its tool
 * later; the decision model is asked after the person's request has answered with the model
 * thinking, and its move lands through the store feed. Either way the person's own move is
 * written and returned first, so the board shows it at once.
 */
export function createGameService(
  input: TurnTableHosts & { now?: () => string; newId?: () => string },
) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const table = createTurnTable({
    ...input,
    miniApp: 'tic-tac-toe',
    noun: 'board',
    now,
    schema: gameSchema,
    initial: () => newGame({ id: newId(), first: 'X', now: now() }),
    owes: owesAgentMove,
    key: positionKey,
    live: (game: Game) => game.status === 'playing',
    agentTurn: (game) => ({ message: askForMove(game), tools: ANSWER_TOOLS }),
    askDecision,
    playDecision: (game, answer: { cell: number }, at) => applyMove(game, answer.cell, 'agent', at),
    refuse: (message) => new MoveRefused(message),
  })

  const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X')
  /** The next game at this table: the other side opens, and the score carries over. */
  const nextGame = (game: Game, at: string, first?: Mark) =>
    newGame({
      id: newId(),
      first: first ?? other(game.first),
      now: at,
      record: game.record,
      opponent: game.opponent,
    })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: table.settled,
    read: table.read,

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Play X at `cell` (0–8). */
    personMove: (chat: ChatRef, cell: number) =>
      table.personTurn(chat, (game, at) => applyMove(game, cell, 'you', at)),
    /** The next game at this table, opened by `first` — else by whoever did not open the last. */
    newGame: (chat: ChatRef, first?: Mark) =>
      table.personTurn(chat, (game, at) => nextGame(game, at, first)),
    /** Ask the agent again for the move it owes. */
    remind: table.remind,
    /** Who plays O from now on; a move O owes is asked of the new opponent at once. */
    setOpponent: table.setOpponent,

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Play O at `cell` (0–8). `answered` says whether the move answered the board's own question —
     * a wake was waiting on it — rather than a request typed in the chat.
     */
    agentMove: (chat: ChatRef, cell: number) =>
      table.agentTurn(chat, (game, at) => applyMove(game, cell, 'agent', at)),
    /**
     * The next game at this table, with `first` moving first. Against the decision model the user
     * opens: only a person's action asks that model, and a tool call is never one.
     */
    agentNewGame: (chat: ChatRef, first: Mark) =>
      table.update(chat, (game, at) =>
        nextGame(game, at, game.opponent === 'decision' ? 'X' : first),
      ),
  }
}

export type GameService = ReturnType<typeof createGameService>
