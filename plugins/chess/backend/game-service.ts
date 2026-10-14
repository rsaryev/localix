import { randomUUID } from 'node:crypto'

import {
  applyMove,
  gameSchema,
  newGame,
  owesAgentMove,
  resign,
  type Game,
  type Side,
} from '../shared/game'
import { other } from '../shared/position'
import { askAgent, positionKey, type Seat, type Wake } from './ask-agent'
import { openJsonStore } from './store'

/**
 * THE GAME AT EACH CHAT'S TABLE, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its seat — the user and the session — and resolves the folder
 * AGAIN, through the host's ownership check: a session that was deleted rejects before anything
 * is read or written, so a request that arrives after the chat is gone can never bring its board
 * back. The host removes the folder with the session; nothing here has to remember to.
 *
 * Two kinds of caller change a game, and they differ in exactly one thing. A PERSON acts in the
 * view — a move, a new game, a reminder — and after that the agent may owe a move, so it is asked
 * (`askAgent`), in the chat the board belongs to. The AGENT acts through its tools and is never
 * asked for anything: a tool that woke the agent would wake it again on every move it made.
 */
export function createGameService(input: {
  /** The session's folder for this plugin; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  now?: () => string
  newId?: () => string
}) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())

  const storeFor = async (seat: Seat) => {
    if (!input.resolveDir)
      throw new Error('This app keeps no per-chat data, so it cannot hold a board.')
    return openJsonStore({
      dir: await input.resolveDir(seat.userId, seat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), you: 'white', now: now() }),
    })
  }

  const update = async (seat: Seat, change: (game: Game, at: string) => Game) =>
    (await storeFor(seat)).update((current) => change(current, now()))

  /**
   * After a person's action: ask the agent for the move it now owes, unless it has been asked for
   * this position already (`again` is the reminder that asks anyway). The answer is recorded only
   * while the board still shows that position — the agent may have moved before it arrived.
   */
  const summon = async (seat: Seat, game: Game, again = false): Promise<Game> => {
    if (!owesAgentMove(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (current) =>
      positionKey(current) === key && current.status === 'playing'
        ? { ...current, waiting }
        : current,
    )
  }

  /** The next game at this table: the person takes the other colour, and the score carries over. */
  const nextGame = (game: Game, at: string, you?: Side) =>
    newGame({ id: newId(), you: you ?? other(game.you), now: at, record: game.record })

  return {
    read: async (seat: Seat): Promise<Game> => (await storeFor(seat)).read(),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Play the move `move` names — SAN or coordinates ("e2e4", "e7e8n"). */
    personMove: async (seat: Seat, move: string) =>
      summon(seat, await update(seat, (game, at) => applyMove(game, move, 'you', at))),
    /** The next game at this table, the person on `you` — else on the other colour. */
    newGame: async (seat: Seat, you?: Side) =>
      summon(seat, await update(seat, (game, at) => nextGame(game, at, you))),
    /** Ask the agent again for the move it owes. */
    remind: async (seat: Seat) => summon(seat, await (await storeFor(seat)).read(), true),

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Play the move `move` names. `answered` says whether the move answered the board's own
     * question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentMove: async (seat: Seat, move: string): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        answered = current.waiting?.status === 'thinking'
        return applyMove(current, move, 'agent', at)
      })
      return { game, answered }
    },
    /** The next game at this table, the user on `you`. */
    agentNewGame: (seat: Seat, you: Side) => update(seat, (game, at) => nextGame(game, at, you)),
    /** Resign the game at this table: the user wins. */
    agentResign: (seat: Seat) => update(seat, (game) => resign(game)),
  }
}

export type GameService = ReturnType<typeof createGameService>
