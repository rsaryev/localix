import { randomUUID } from 'node:crypto'

import {
  agentPlays,
  gameSchema,
  newGame,
  type Direction,
  type Game,
  type Mode,
} from '../shared/game'
import { applyMove, playMoves, type Plan, type Played } from '../shared/play'
import { askAgent, positionKey, type Seat, type Wake } from './ask-agent'
import { openJsonStore } from './store'

/**
 * THE BOARD AT EACH CHAT, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its seat and resolves the folder AGAIN, through the host's
 * ownership check: a session that was deleted rejects before anything is read or written.
 *
 * Two kinds of caller change a game, and they differ in exactly one thing. A PERSON acts in the
 * view — a move, a new game, handing the board over, asking the agent to continue — and when the
 * board is then the agent's to play, the agent is asked (`askAgent`). The AGENT acts through its
 * tool and is never asked for anything: a tool that woke the agent would wake it again after
 * every call.
 */
export function createGameService(input: {
  /** The session's folder for this plugin; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  now?: () => string
  newId?: () => string
  random?: () => number
}) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  const random = input.random ?? Math.random

  const storeFor = async (seat: Seat) => {
    if (!input.resolveDir)
      throw new Error('This app keeps no per-chat data, so it cannot hold a board.')
    return openJsonStore({
      dir: await input.resolveDir(seat.userId, seat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), mode: 'user', now: now(), random }),
    })
  }

  const update = async (seat: Seat, change: (game: Game) => Game) =>
    (await storeFor(seat)).update(change)

  /**
   * After a person's action: hand the board to the agent when it is now the agent's to play,
   * unless it was handed over for this position already (`again` is the reminder that asks
   * anyway). The answer is recorded only while the board still shows that position — the agent
   * may have moved before it arrived.
   */
  const summon = async (seat: Seat, game: Game, again = false): Promise<Game> => {
    if (!agentPlays(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (current) =>
      positionKey(current) === key && agentPlays(current) ? { ...current, waiting } : current,
    )
  }

  const fresh = (game: Game, mode: Mode) =>
    newGame({ id: newId(), mode, now: now(), best: game.best, random })

  return {
    read: async (seat: Seat): Promise<Game> => (await storeFor(seat)).read(),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    personMove: (seat: Seat, direction: Direction) =>
      update(seat, (game) => applyMove(game, direction, 'user', now(), random)),
    newGame: async (seat: Seat, mode: Mode) =>
      summon(seat, await update(seat, (game) => fresh(game, mode))),
    /** Hand the board to `mode`; the agent is asked to play when it is handed to it. */
    mode: async (seat: Seat, mode: Mode) =>
      summon(seat, await update(seat, (game) => ({ ...game, mode, waiting: null }))),
    /** Ask the agent again to go on playing. */
    remind: async (seat: Seat) => summon(seat, await (await storeFor(seat)).read(), true),

    // ── What the agent does through its tool ───────────────────────────────────────────────
    /** Play `plan` as one change; see `playMoves` for what is skipped and refused. */
    agentMoves: async (seat: Seat, plan: Plan): Promise<Played> => {
      let result: Played | undefined
      await update(seat, (current) => {
        result = playMoves(current, plan, 'agent', now(), random)
        return result.game
      })
      return result!
    },
    agentNewGame: (seat: Seat, mode: Mode) => update(seat, (game) => fresh(game, mode)),
  }
}

export type GameService = ReturnType<typeof createGameService>
