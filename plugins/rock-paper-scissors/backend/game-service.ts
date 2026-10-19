import { randomUUID } from 'node:crypto'
import { openJsonStore, seal, type DecisionHost } from '@localixai/plugin-sdk/backend'
import { DECISION_HOLDS_SEAT, defaultOpponent, type Opponent } from '@localixai/plugin-sdk/opponent'

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
import { askAgent, roundKey, type Seat, type Wake } from './ask-agent'
import { askDecision } from './ask-decision'

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
 *
 * Who fills the agent's seat depends on the table's `opponent`: the agent is woken and moves with
 * its tool later; the decision model is asked here — from the finished rounds only — and its move
 * is sealed and played before the person's request answers.
 */
export function createGameService(input: {
  /** The session's folder for this plugin; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  /** `ctx.host.decisions` — the decision model, on the backend load too. */
  decisions?: DecisionHost
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

  /**
   * A table whose opponent is not settled takes the default now: the decision model when it can
   * answer, else the agent. Only the backend load can ask (`decisions`); a tool call leaves it.
   */
  const settle = async (seat: Seat, game: Game): Promise<Game> => {
    if (game.opponent !== null || !input.decisions) return game
    const opponent = await defaultOpponent(input.decisions, seat.userId)
    return update(seat, (current) =>
      current.opponent === null ? { ...current, opponent } : current,
    )
  }

  const play = (seat: Seat, player: Player, move: Move) =>
    update(seat, (game, at) => applyMove(game, seal(move, player, at), at))

  /**
   * After a person's action: ask the agent for the move it now owes, unless it was asked for this
   * round already (`again` is the reminder that asks anyway). The answer is recorded only while
   * the round still waits for it — the agent may have moved before it arrived.
   */
  const summon = async (seat: Seat, current: Game, again = false): Promise<Game> => {
    const game = await settle(seat, current)
    if (!owesAgentMove(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = roundKey(game)
    const unchanged = (latest: Game) => roundKey(latest) === key && owesAgentMove(latest)
    if (game.opponent === 'decision') {
      const answer = await askDecision(input.decisions, seat, game, now())
      return update(seat, (latest, at) =>
        !unchanged(latest) || latest.opponent !== 'decision'
          ? latest
          : 'move' in answer
            ? applyMove(latest, seal(answer.move, 'agent', at), at)
            : { ...latest, waiting: answer.waiting },
      )
    }
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (latest) => (unchanged(latest) ? { ...latest, waiting } : latest))
  }

  return {
    read: async (seat: Seat): Promise<Game> => settle(seat, await (await storeFor(seat)).read()),

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
    /** Who fills the other seat from now on; a move it owes is asked of the new opponent at once. */
    setOpponent: async (seat: Seat, opponent: Opponent) =>
      summon(
        seat,
        await update(seat, (game) =>
          game.opponent === opponent ? game : { ...game, opponent, waiting: null },
        ),
        true,
      ),

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /** `answered` says whether the move answered the table's own wake. */
    agentMove: async (seat: Seat, move: Move): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        if (current.opponent === 'decision') throw new MoveRefused(DECISION_HOLDS_SEAT)
        answered = current.waiting?.status === 'thinking'
        return applyMove(current, seal(move, 'agent', at), at)
      })
      return { game, answered }
    },
    /**
     * The next round, `first` opening. Against the decision model the user opens: only a person's
     * action asks that model, and a tool call is never one.
     */
    agentNextRound: (seat: Seat, first: Player) =>
      update(seat, (game, at) =>
        nextRound(game, {
          id: newId(),
          now: at,
          first: game.opponent === 'decision' ? 'you' : first,
        }),
      ),
  }
}

export type GameService = ReturnType<typeof createGameService>
