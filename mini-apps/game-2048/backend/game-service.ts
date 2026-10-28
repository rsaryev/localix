import { randomUUID } from 'node:crypto'

import {
  agentPlays,
  decisionPlays,
  gameSchema,
  MoveRefused,
  newGame,
  type Direction,
  type Game,
  type Mode,
  type Opponent,
  STOPPED_REASON,
  stopped,
} from '../shared/game'
import { applyMove, playMoves, type Plan, type Played } from '../shared/play'
import { askAgent, positionKey, type ChatRef, type Wake } from './ask-agent'
import { askDecision } from './ask-decision'
import { openJsonStore, type DecisionHost } from '@localixai/mini-app-sdk/backend'
import { DECISION_HOLDS_TURN, defaultOpponent } from '@localixai/mini-app-sdk/opponent'

/**
 * The most moves one run of the decision model plays — a safety bound, above any real game (2048
 * is reached in about a thousand moves). A run that reaches it stops; Continue starts another.
 */
export const DECISION_RUN_MOVES = 2500

/**
 * THE BOARD AT EACH CHAT, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its chat and resolves the folder AGAIN, through the host's
 * ownership check: a session that was deleted rejects before anything is read or written.
 *
 * Two kinds of caller change a game, and they differ in exactly one thing. A PERSON acts in the
 * view — a move, a new game, handing the board over, asking the agent to continue — and when the
 * board is then the agent's to play, the agent is asked (`askAgent`). The AGENT acts through its
 * tool and is never asked for anything: a tool that woke the agent would wake it again after
 * every call.
 *
 * Who plays an `agent` board is the board's `opponent`. The chat agent is woken as above. The
 * decision model is asked by the board itself: a run in the background asks it for one move at a
 * time and writes each one, so the open board shows every move as it lands (the store feed), and
 * the run stops the moment the game ends, the person takes the board back or changes the
 * opponent, or a decision comes back without a move — whose reason the board then shows.
 */
export function createGameService(input: {
  /** The session's folder for this mini app; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  /** `ctx.host.decisions` — the decision model, on the backend load too. */
  decisions?: DecisionHost
  now?: () => string
  newId?: () => string
  random?: () => number
}) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const random = input.random ?? Math.random

  const storeFor = async (chat: ChatRef) => {
    if (!input.resolveDir)
      throw new Error('This app keeps no per-chat data, so it cannot hold a board.')
    return openJsonStore({
      dir: await input.resolveDir(chat.userId, chat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), mode: 'user', now: now(), random }),
    })
  }

  const update = async (chat: ChatRef, change: (game: Game) => Game) =>
    (await storeFor(chat)).update(change)

  /**
   * A board whose opponent is not settled takes the default now: the decision model when it can
   * answer, else the agent. Only the backend load can ask (`decisions`); a tool call leaves it.
   */
  const settle = async (chat: ChatRef, game: Game): Promise<Game> => {
    if (game.opponent !== null || !input.decisions) return game
    const opponent = await defaultOpponent(input.decisions, chat.userId)
    return update(chat, (current) =>
      current.opponent === null ? { ...current, opponent } : current,
    )
  }

  /** One run per board at a time: a second summon while one plays joins it. */
  const runs = new Map<string, Promise<void>>()

  /** The decision model plays the board, one asked move at a time, until something stops it. */
  const runDecision = async (chat: ChatRef) => {
    for (let played = 0; played < DECISION_RUN_MOVES; played++) {
      const game = await (await storeFor(chat)).read()
      if (!decisionPlays(game) || game.waiting?.status !== 'thinking') return
      const key = positionKey(game)
      const answer = await askDecision(input.decisions, chat, game, now())
      // A Stop that landed while the model was asked drops its answer.
      const unchanged = (current: Game) =>
        positionKey(current) === key &&
        decisionPlays(current) &&
        current.waiting?.status === 'thinking'
      const after = await update(chat, (current) =>
        !unchanged(current)
          ? current
          : 'direction' in answer
            ? playMoves(current, { moves: [answer.direction] }, 'agent', now(), random).game
            : { ...current, waiting: answer.waiting },
      )
      if ('waiting' in answer || positionKey(after) === key) return
    }
  }

  const startDecision = (chat: ChatRef) => {
    const key = `${chat.userId}:${chat.sessionId}`
    if (runs.has(key)) return
    const run = runDecision(chat)
      .catch((error) => console.warn('[game-2048] the decision model stopped playing', error))
      .finally(() => runs.delete(key))
    runs.set(key, run)
  }

  /**
   * After a person's action: hand the board to the agent when it is now the agent's to play,
   * unless it was handed over for this position already (`again` is the reminder that asks
   * anyway). The answer is recorded only while the board still shows that position — the agent
   * may have moved before it arrived.
   */
  const summon = async (chat: ChatRef, current: Game, again = false): Promise<Game> => {
    const game = await settle(chat, current)
    if (!agentPlays(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    if (game.opponent === 'decision') {
      const playing = await update(chat, (latest) =>
        positionKey(latest) === key && decisionPlays(latest)
          ? { ...latest, waiting: { since: now(), status: 'thinking' } }
          : latest,
      )
      startDecision(chat)
      return playing
    }
    const waiting = await askAgent(input.wake, chat, game, now())
    return update(chat, (current) =>
      positionKey(current) === key && agentPlays(current) ? { ...current, waiting } : current,
    )
  }

  const fresh = (game: Game, mode: Mode) =>
    newGame({ id: newId(), mode, now: now(), best: game.best, opponent: game.opponent, random })

  return {
    read: async (chat: ChatRef): Promise<Game> => settle(chat, await (await storeFor(chat)).read()),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    personMove: (chat: ChatRef, direction: Direction) =>
      update(chat, (game) => applyMove(game, direction, 'user', now(), random)),
    newGame: async (chat: ChatRef, mode: Mode) =>
      summon(chat, await update(chat, (game) => fresh(game, mode))),
    /** Hand the board to `mode`; the agent is asked to play when it is handed to it. */
    mode: async (chat: ChatRef, mode: Mode) =>
      summon(chat, await update(chat, (game) => ({ ...game, mode, waiting: null }))),
    /** Ask the agent again to go on playing. */
    remind: async (chat: ChatRef) => summon(chat, await (await storeFor(chat)).read(), true),
    /**
     * Pause whoever plays the board — the decision model's run ends before its next move, and the
     * chat agent's next move is refused — until Continue (`remind`) hands it back.
     */
    stop: (chat: ChatRef) =>
      update(chat, (game) =>
        agentPlays(game)
          ? { ...game, waiting: { since: now(), status: 'unreachable', reason: STOPPED_REASON } }
          : game,
      ),
    /** Who plays an `agent` board from now on; an `agent` board is handed to it at once. */
    setOpponent: async (chat: ChatRef, opponent: Opponent) =>
      summon(
        chat,
        await update(chat, (game) =>
          game.opponent === opponent ? game : { ...game, opponent, waiting: null },
        ),
        true,
      ),

    // ── What the agent does through its tool ───────────────────────────────────────────────
    /** Play `plan` as one change; see `playMoves` for what is skipped and refused. */
    agentMoves: async (chat: ChatRef, plan: Plan): Promise<Played> => {
      let result: Played | undefined
      await update(chat, (current) => {
        if (decisionPlays(current)) throw new MoveRefused(DECISION_HOLDS_TURN)
        if (stopped(current))
          throw new MoveRefused('The user stopped you. Wait until they press Continue.')
        result = playMoves(current, plan, 'agent', now(), random)
        return result.game
      })
      return result!
    },
    agentNewGame: (chat: ChatRef, mode: Mode) => update(chat, (game) => fresh(game, mode)),

    /** Test seam: wait for every decision run in flight. */
    idle: async () => {
      while (runs.size) await Promise.all(runs.values())
    },
  }
}

export type GameService = ReturnType<typeof createGameService>
