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
import { placeFleet } from '../shared/rules'
import { askAgent, positionKey, type Seat, type Wake } from './ask-agent'
import { openJsonStore } from '@localixai/plugin-sdk/backend'

/**
 * THE GAME AT EACH CHAT'S TABLE, and every way it changes.
 *
 * One board per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its seat — the user and the session — and resolves the folder
 * AGAIN, through the host's ownership check: a session that was deleted rejects before anything
 * is read or written, so a request that arrives after the chat is gone can never bring its board
 * back. The host removes the folder with the session; nothing here has to remember to.
 *
 * The WHOLE game — both fleets — lives only here. Callers project it for one side before it leaves
 * (`viewFor`), so what the service returns is never sent anywhere as it is.
 *
 * Two kinds of caller change a game, and they differ in exactly one thing. A PERSON acts in the
 * view — a shot, a new game, a new fleet, a reminder — and after that the agent may owe a shot, so
 * it is asked (`askAgent`), in the chat the board belongs to. The AGENT acts through its tools and
 * is never asked for anything: a tool that woke the agent would wake it again on every shot.
 */
export function createGameService(input: {
  /** The session's folder for this plugin; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  now?: () => string
  newId?: () => string
  /** A number in [0, 1) — the fleets' dice. Seeded in tests so a fleet is the same every run. */
  random?: () => number
}) {
  const now = input.now ?? (() => new Date().toISOString())
  const newId = input.newId ?? (() => randomUUID())
  // A cryptographic source: the agent reading the code must not be able to predict the fleet.
  const random = input.random ?? (() => randomInt(0, 2 ** 32) / 2 ** 32)
  const fleets = () => ({ you: placeFleet(random), agent: placeFleet(random) })

  const storeFor = async (seat: Seat) => {
    if (!input.resolveDir)
      throw new Error('This app keeps no per-chat data, so it cannot hold a board.')
    return openJsonStore({
      dir: await input.resolveDir(seat.userId, seat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), first: 'you', fleets: fleets(), now: now() }),
    })
  }

  const update = async (seat: Seat, change: (game: Game, at: string) => Game) =>
    (await storeFor(seat)).update((current) => change(current, now()))

  /**
   * After a person's action: ask the agent for the shot it now owes, unless it has been asked for
   * this position already (`again` is the reminder that asks anyway). The answer is recorded only
   * while the board still shows that position — the agent may have fired before it arrived.
   */
  const summon = async (seat: Seat, game: Game, again = false): Promise<Game> => {
    if (!owesAgentShot(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (current) =>
      positionKey(current) === key && current.status === 'playing'
        ? { ...current, waiting }
        : current,
    )
  }

  /** The next game at this table: fresh fleets, the other side fires first, the score carries. */
  const nextGame = (game: Game, at: string, first?: Player) =>
    newGame({
      id: newId(),
      first: first ?? opponentOf(game.first),
      fleets: fleets(),
      now: at,
      record: game.record,
    })

  return {
    read: async (seat: Seat): Promise<Game> => (await storeFor(seat)).read(),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Fire at `cell` (0–99) on the agent's board. */
    personShot: async (seat: Seat, cell: number) =>
      summon(seat, await update(seat, (game, at) => applyShot(game, 'you', cell, at))),
    /** Place the person's fleet anew — only before anyone has fired, when it can change nothing. */
    reshuffle: (seat: Seat) =>
      update(seat, (game) => {
        if (game.shots.length > 0)
          throw new ShotRefused('The fleet is set once the first shot is fired.')
        return { ...game, fleets: { ...game.fleets, you: placeFleet(random) } }
      }),
    /** The next game at this table, with `first` firing first — else the side that did not. */
    newGame: async (seat: Seat, first?: Player) =>
      summon(seat, await update(seat, (game, at) => nextGame(game, at, first))),
    /** Ask the agent again for the shot it owes. */
    remind: async (seat: Seat) => summon(seat, await (await storeFor(seat)).read(), true),

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Fire at `cell` (0–99) on the user's board. `answered` says whether the shot answered the
     * board's own question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentShot: async (seat: Seat, cell: number): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        answered = current.waiting?.status === 'thinking'
        return applyShot(current, 'agent', cell, at)
      })
      return { game, answered }
    },
    /** The next game at this table, with `first` firing first. */
    agentNewGame: (seat: Seat, first: Player) =>
      update(seat, (game, at) => nextGame(game, at, first)),
  }
}

export type GameService = ReturnType<typeof createGameService>
