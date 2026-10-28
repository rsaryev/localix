import { randomInt, randomUUID } from 'node:crypto'

import {
  ShotRefused,
  applyShot,
  gameSchema,
  newGame,
  opponentOf,
  owesAgentShot,
  type Game,
  type Player,
} from '../shared/game'
import { SIZE, placeFleet } from '../shared/rules'
import { ANSWER_TOOLS, askForShot, positionKey, type ChatRef } from './ask-agent'
import { askDecision } from './ask-decision'
import { createTurnTable, type TurnTableHosts } from '@localixai/mini-app-sdk/backend'

/**
 * THE GAME AT EACH CHAT'S TABLE, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder; the turn-taking — who is asked
 * for the agent side's shot, once per position, and how its answer lands — is the SDK's
 * `createTurnTable`, shared by every game with the agent as its opponent. What is battleship's
 * own is here: the fleets, a shot, and what the next game at the table looks like.
 *
 * The WHOLE game — both fleets — lives only here. Callers project it for one side before it leaves
 * (`viewFor`), so what the service returns is never sent anywhere as it is.
 *
 * Who fires from the agent's side depends on the table's `opponent`: the agent is woken and fires
 * with its tool later; the decision model is asked shot after shot while its hits keep the turn
 * (`maxDecisionTurns`), after the person's request has answered with the model thinking. Each
 * shot is written as it lands and reaches the board through the store feed, one by one; the
 * person's own shot is written and returned first.
 */
export function createGameService(
  input: TurnTableHosts & {
    now?: () => string
    newId?: () => string
    /** A number in [0, 1) — the fleets' dice. Seeded in tests so a fleet is the same every run. */
    random?: () => number
  },
) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  // A cryptographic source: the agent reading the code must not be able to predict the fleet.
  const random = input.random ?? (() => randomInt(0, 2 ** 32) / 2 ** 32)
  const fleets = () => ({ you: placeFleet(random), agent: placeFleet(random) })
  const table = createTurnTable({
    ...input,
    miniApp: 'battleship',
    noun: 'board',
    now,
    schema: gameSchema,
    initial: () => newGame({ id: newId(), first: 'you', fleets: fleets(), now: now() }),
    owes: owesAgentShot,
    key: positionKey,
    live: (game: Game) => game.status === 'playing',
    agentTurn: (game) => ({ message: askForShot(game), tools: ANSWER_TOOLS }),
    askDecision,
    playDecision: (game, answer: { cell: number }, at) => applyShot(game, 'agent', answer.cell, at),
    // A hit earns another shot; the board has no more cells than this to fire at.
    maxDecisionTurns: SIZE * SIZE,
    refuse: (message) => new ShotRefused(message),
  })

  /** The next game at this table: fresh fleets, the other side fires first, the score carries. */
  const nextGame = (game: Game, at: string, first?: Player) =>
    newGame({
      id: newId(),
      first: first ?? opponentOf(game.first),
      fleets: fleets(),
      now: at,
      record: game.record,
      opponent: game.opponent,
    })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: table.settled,
    read: table.read,

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Fire at `cell` (0–99) on the agent's board. */
    personShot: (chat: ChatRef, cell: number) =>
      table.personTurn(chat, (game, at) => applyShot(game, 'you', cell, at)),
    /** Place the person's fleet anew — only before anyone has fired, when it can change nothing. */
    reshuffle: (chat: ChatRef) =>
      table.update(chat, (game) => {
        if (game.shots.length > 0)
          throw new ShotRefused('The fleet is set once the first shot is fired.')
        return { ...game, fleets: { ...game.fleets, you: placeFleet(random) } }
      }),
    /** The next game at this table, with `first` firing first — else the side that did not. */
    newGame: (chat: ChatRef, first?: Player) =>
      table.personTurn(chat, (game, at) => nextGame(game, at, first)),
    /** Ask the agent again for the shot it owes. */
    remind: table.remind,
    /** Who fires from the agent's side from now on; a shot it owes is asked of it at once. */
    setOpponent: table.setOpponent,

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Fire at `cell` (0–99) on the user's board. `answered` says whether the shot answered the
     * board's own question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentShot: (chat: ChatRef, cell: number) =>
      table.agentTurn(chat, (game, at) => applyShot(game, 'agent', cell, at)),
    /**
     * The next game at this table, with `first` firing first. Against the decision model the user
     * opens: only a person's action asks that model, and a tool call is never one.
     */
    agentNewGame: (chat: ChatRef, first: Player) =>
      table.update(chat, (game, at) =>
        nextGame(game, at, game.opponent === 'decision' ? 'you' : first),
      ),
  }
}

export type GameService = ReturnType<typeof createGameService>
