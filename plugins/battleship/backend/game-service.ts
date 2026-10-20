import { randomInt, randomUUID } from 'node:crypto'

import {
  ShotRefused,
  applyShot,
  gameSchema,
  newGame,
  opponentOf,
  owesAgentShot,
  type Game,
  type Opponent,
  type Player,
} from '../shared/game'
import { SIZE, placeFleet } from '../shared/rules'
import { askAgent, positionKey, type Seat, type Wake } from './ask-agent'
import { askDecision } from './ask-decision'
import { decisionTurns, openJsonStore, type DecisionHost } from '@localixai/plugin-sdk/backend'
import { DECISION_HOLDS_SEAT, defaultOpponent } from '@localixai/plugin-sdk/opponent'

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
 *
 * Who fires from the agent's side depends on the table's `opponent`: the agent is woken and fires
 * with its tool later; the decision model is asked here, shot after shot while its hits keep the
 * turn, after the person's request has answered with the model thinking (`decisionTurns`). Each
 * shot is written as it lands and reaches the board through the store feed, one by one; the
 * person's own shot is written and returned first.
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

  const turns = decisionTurns('battleship')

  /**
   * The decision model's shots while the table owes one — a hit earns another — each written as it
   * lands, and only while the board still shows the position it was asked about. Read fresh: a
   * turn queued behind another finds the table as it is now.
   */
  const decisionTurn = async (seat: Seat): Promise<void> => {
    let current = await (await storeFor(seat)).read()
    for (
      let shot = 0;
      shot < SIZE * SIZE && current.opponent === 'decision' && owesAgentShot(current);
      shot++
    ) {
      const key = positionKey(current)
      const answer = await askDecision(input.decisions, seat, current, now())
      const next = await update(seat, (latest, at) =>
        positionKey(latest) !== key || latest.status !== 'playing' || latest.opponent !== 'decision'
          ? latest
          : 'cell' in answer
            ? applyShot(latest, 'agent', answer.cell, at)
            : { ...latest, waiting: answer.waiting },
      )
      if (!('cell' in answer) || positionKey(next) === key) return
      current = next
    }
  }

  /**
   * After a person's action: ask the agent for the shot it now owes, unless it has been asked for
   * this position already (`again` is the reminder that asks anyway). The answer is recorded only
   * while the board still shows that position — the agent may have fired before it arrived.
   */
  const summon = async (seat: Seat, settled: Game, again = false): Promise<Game> => {
    const game = await settle(seat, settled)
    if (!owesAgentShot(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    if (game.opponent === 'decision') {
      // Answer the person now, with the model thinking; its shots land through the store feed.
      const thinking = await update(seat, (current, at) =>
        positionKey(current) === key &&
        current.status === 'playing' &&
        current.opponent === 'decision'
          ? { ...current, waiting: { since: at, status: 'thinking' } }
          : current,
      )
      turns.start(seat, () => decisionTurn(seat))
      return thinking
    }
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
      opponent: game.opponent,
    })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: turns.idle,
    read: async (seat: Seat): Promise<Game> => settle(seat, await (await storeFor(seat)).read()),

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
    /** Who fires from the agent's side from now on; a shot it owes is asked of it at once. */
    setOpponent: async (seat: Seat, opponent: Opponent) =>
      summon(
        seat,
        await update(seat, (game) =>
          game.opponent === opponent ? game : { ...game, opponent, waiting: null },
        ),
        true,
      ),

    // ── What the agent does through its tools ──────────────────────────────────────────────
    /**
     * Fire at `cell` (0–99) on the user's board. `answered` says whether the shot answered the
     * board's own question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentShot: async (seat: Seat, cell: number): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        if (current.opponent === 'decision') throw new ShotRefused(DECISION_HOLDS_SEAT)
        answered = current.waiting?.status === 'thinking'
        return applyShot(current, 'agent', cell, at)
      })
      return { game, answered }
    },
    /**
     * The next game at this table, with `first` firing first. Against the decision model the user
     * opens: only a person's action asks that model, and a tool call is never one.
     */
    agentNewGame: (seat: Seat, first: Player) =>
      update(seat, (game, at) => nextGame(game, at, game.opponent === 'decision' ? 'you' : first)),
  }
}

export type GameService = ReturnType<typeof createGameService>
