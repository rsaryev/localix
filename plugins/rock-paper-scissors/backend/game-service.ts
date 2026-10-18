import { randomUUID } from 'node:crypto'
import { openJsonStore, seal } from '@localixai/plugin-sdk/backend'

import {
  applyMove,
  gameSchema,
  newGame,
  nextRound,
  owesAgentMove,
  type Game,
  type Move,
  type Player,
} from '../shared/game'
import { askAgent, roundKey, type Seat, type Wake } from './ask-agent'

/**
 * THE TABLE AT EACH CHAT, and every way it changes.
 *
 * One table per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage), resolved again on every operation through the host's ownership check — a deleted chat
 * rejects before anything is read or written.
 *
 * Every move is SEALED here, the moment it arrives (`seal`: a fresh salt and its digest), so the
 * stored round already holds the commitment the other side will be shown. A PERSON's action may
 * leave the agent owing a move, so it is asked (`askAgent`); the AGENT acts through its tools and
 * is never asked for anything.
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
      throw new Error('This app keeps no per-chat data, so it cannot hold a table.')
    return openJsonStore({
      dir: await input.resolveDir(seat.userId, seat.sessionId),
      file: 'game.json',
      schema: gameSchema,
      initial: newGame({ id: newId(), roundId: newId(), first: 'you', now: now() }),
    })
  }

  const update = async (seat: Seat, change: (game: Game, at: string) => Game) =>
    (await storeFor(seat)).update((current) => change(current, now()))

  const play = (seat: Seat, player: Player, move: Move) =>
    update(seat, (game, at) => applyMove(game, seal(move, player, at), at))

  /**
   * After a person's action: ask the agent for the move it now owes, unless it was asked for this
   * round already (`again` is the reminder that asks anyway). The answer is recorded only while
   * the round still waits for it — the agent may have moved before it arrived.
   */
  const summon = async (seat: Seat, game: Game, again = false): Promise<Game> => {
    if (!owesAgentMove(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = roundKey(game)
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (current) =>
      roundKey(current) === key && owesAgentMove(current) ? { ...current, waiting } : current,
    )
  }

  return {
    read: async (seat: Seat): Promise<Game> => (await storeFor(seat)).read(),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    personMove: async (seat: Seat, move: Move) => summon(seat, await play(seat, 'you', move)),
    /** The next round, opened by `first` — else by whoever did not open the last. */
    nextRound: async (seat: Seat, first?: Player) =>
      summon(
        seat,
        await update(seat, (game, at) => nextRound(game, { id: newId(), now: at, first })),
      ),
    /** Ask the agent again for the move it owes. */
    remind: async (seat: Seat) => summon(seat, await (await storeFor(seat)).read(), true),

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /** `answered` says whether the move answered the table's own wake. */
    agentMove: async (seat: Seat, move: Move): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        answered = current.waiting?.status === 'thinking'
        return applyMove(current, seal(move, 'agent', at), at)
      })
      return { game, answered }
    },
    agentNextRound: (seat: Seat, first: Player) =>
      update(seat, (game, at) => nextRound(game, { id: newId(), now: at, first })),
  }
}

export type GameService = ReturnType<typeof createGameService>
