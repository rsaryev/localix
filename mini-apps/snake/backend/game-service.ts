import { randomInt, randomUUID } from 'node:crypto'

import { openJsonStore, type DecisionHost, type ChatRef } from '@localixai/mini-app-sdk/backend'

import {
  gameSchema,
  modelPlays,
  MoveRefused,
  newGame,
  replay,
  step,
  STOPPED_REASON,
  type Direction,
  type Game,
  type Mode,
} from '../shared/game'
import { askDecision } from './ask-decision'

/**
 * The most moves one run of the decision model plays — a safety bound above a long real game.
 * A run that reaches it stops; Continue starts another.
 */
export const MODEL_RUN_MOVES = 2000

/**
 * The shortest time between two of the model's moves, so the board shows a snake moving rather
 * than a jump when the model answers fast. The decision call itself usually takes longer.
 */
export const MODEL_PACE_MS = 120

/** The most headings one save carries: about 30 s of play at one tick per 150 ms. */
export const MAX_HEADINGS = 200

/**
 * THE BOARD AT EACH CHAT, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its chat and resolves the folder AGAIN, through the host's
 * ownership check: a session that was deleted rejects before anything is read or written.
 *
 * The person's game runs in the view, which sends the headings it played (`personTurns`); they are
 * replayed here from the stored board, so what is saved is the board the rules make, not one the
 * view claims. The decision model's game runs here: a run in the background asks it for one
 * heading at a time and writes each move, so the open board shows every move as it lands (the
 * store feed). The run stops the moment the snake dies, the person takes the board back, presses
 * Stop, or a decision comes back without a move — whose reason the board then shows.
 */
export function createGameService(input: {
  /** The session's folder for this mini app; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.decisions` — the decision model, on the backend load. */
  decisions?: DecisionHost
  now?: () => string
  newId?: () => string
  newSeed?: () => number
  /** Test seam: the pause between the model's moves. */
  paceMs?: number
}) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const newSeed = input.newSeed ?? (() => randomInt(0, 0xffffffff))
  const paceMs = input.paceMs ?? MODEL_PACE_MS

  const storeFor = async (chat: ChatRef) => {
    if (!input.resolveDir)
      throw new Error('This app keeps no per-chat data, so it cannot hold a board.')
    return openJsonStore({
      dir: await input.resolveDir(chat.userId, chat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), mode: 'user', now: now(), seed: newSeed() }),
    })
  }

  const read = async (chat: ChatRef) => (await storeFor(chat)).read()
  const update = async (chat: ChatRef, change: (game: Game) => Game) =>
    (await storeFor(chat)).update(change)

  /** One run per board at a time: a second start while one plays joins it. */
  const runs = new Map<string, Promise<void>>()
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /** The model steers until something stops it. */
  const runModel = async (chat: ChatRef) => {
    for (let played = 0; played < MODEL_RUN_MOVES; played++) {
      const game = await read(chat)
      if (!modelPlays(game) || game.waiting?.status !== 'thinking') return
      const started = Date.now()
      const answer = await askDecision(input.decisions, chat, game, now())
      // A Stop, a new game or the person taking over while the model was asked drops its answer.
      const unchanged = (current: Game) =>
        current.id === game.id &&
        current.tick === game.tick &&
        modelPlays(current) &&
        current.waiting?.status === 'thinking'
      const after = await update(chat, (current) =>
        !unchanged(current)
          ? current
          : 'direction' in answer
            ? step(current, answer.direction)
            : { ...current, waiting: answer.waiting },
      )
      if ('waiting' in answer || after.tick === game.tick) return
      const rest = paceMs - (Date.now() - started)
      if (rest > 0) await pause(rest)
    }
  }

  const startModel = (chat: ChatRef) => {
    const key = `${chat.userId}:${chat.sessionId}`
    if (runs.has(key)) return
    const run = runModel(chat)
      .catch((error) => console.warn('[snake] the decision model stopped playing', error))
      .finally(() => runs.delete(key))
    runs.set(key, run)
  }

  /** After a person's action: when the model now steers, start it. */
  const summon = async (chat: ChatRef, game: Game): Promise<Game> => {
    if (!modelPlays(game)) return game
    const playing = await update(chat, (latest) =>
      latest.id === game.id && modelPlays(latest)
        ? { ...latest, waiting: { since: now(), status: 'thinking' } }
        : latest,
    )
    startModel(chat)
    return playing
  }

  const fresh = (game: Game, mode: Mode) =>
    newGame({ id: newId(), mode, now: now(), best: game.best, seed: newSeed() })

  return {
    read,

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /**
     * The headings the person played since tick `fromTick`, one per tick. Refused when the stored
     * board is not at that tick (another tab moved it, or a new game began): the view reads again.
     */
    personTurns: (chat: ChatRef, fromTick: number, headings: readonly Direction[]) =>
      update(chat, (game) => {
        if (game.mode !== 'user') throw new MoveRefused('The decision model steers this board.')
        if (game.tick !== fromTick)
          throw new MoveRefused('The board moved on since. Read it again and continue from there.')
        return replay(game, headings)
      }),
    newGame: async (chat: ChatRef, mode: Mode) =>
      summon(chat, await update(chat, (game) => fresh(game, mode))),
    /** Hand the board to `mode`; the model starts at once when it is handed to it. */
    mode: async (chat: ChatRef, mode: Mode) =>
      summon(chat, await update(chat, (game) => ({ ...game, mode, waiting: null }))),
    /** Continue: ask the model again after a miss or a Stop. */
    remind: async (chat: ChatRef) => {
      const game = await update(chat, (current) =>
        modelPlays(current) ? { ...current, waiting: null } : current,
      )
      return summon(chat, game)
    },
    /** Pause the model before its next move, until Continue. */
    stop: (chat: ChatRef) =>
      update(chat, (game) =>
        modelPlays(game)
          ? { ...game, waiting: { since: now(), status: 'unreachable', reason: STOPPED_REASON } }
          : game,
      ),
    /** A new game started by the chat agent: always the person's to play. */
    agentNewGame: (chat: ChatRef) => update(chat, (game) => fresh(game, 'user')),

    /** Test seam: wait for every model run in flight. */
    idle: async () => {
      while (runs.size) await Promise.all(runs.values())
    },
  }
}

export type GameService = ReturnType<typeof createGameService>
