import { randomUUID } from 'node:crypto'

import {
  applyMove,
  gameSchema,
  MoveRefused,
  newGame,
  owesAgentMove,
  resign,
  type Game,
  type Opponent,
  type Side,
} from '../shared/game'
import { other } from '../shared/rules'
import { askAgent, positionKey, type Seat, type Wake } from './ask-agent'
import { askDecision } from './ask-decision'
import { openJsonStore, type DecisionHost } from '@localixai/plugin-sdk/backend'
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
 * Two kinds of caller change a game, and they differ in exactly one thing. A PERSON acts in the
 * view — a move, a new game, a reminder — and after that the agent may owe a move, so it is asked
 * (`askAgent`), in the chat the board belongs to. The AGENT acts through its tools and is never
 * asked for anything: a tool that woke the agent would wake it again on every move it made.
 *
 * Who answers the other colour depends on the table's `opponent`: the agent is woken and moves
 * with its tool later; the decision model is asked here and its move is played before the person's
 * request answers. Either way the person's own move is written first, so the board shows it at once.
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

  /**
   * After a person's action: ask the agent for the move it now owes, unless it has been asked for
   * this position already (`again` is the reminder that asks anyway). The answer is recorded only
   * while the board still shows that position — the agent may have moved before it arrived.
   */
  const summon = async (seat: Seat, current: Game, again = false): Promise<Game> => {
    const game = await settle(seat, current)
    if (!owesAgentMove(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const key = positionKey(game)
    const unchanged = (latest: Game) => positionKey(latest) === key && latest.status === 'playing'
    if (game.opponent === 'decision') {
      const answer = await askDecision(input.decisions, seat, game, now())
      return update(seat, (latest, at) =>
        !unchanged(latest) || latest.opponent !== 'decision'
          ? latest
          : 'squares' in answer
            ? applyMove(latest, answer.squares, 'agent', at)
            : { ...latest, waiting: answer.waiting },
      )
    }
    const waiting = await askAgent(input.wake, seat, game, now())
    return update(seat, (latest) => (unchanged(latest) ? { ...latest, waiting } : latest))
  }

  /** The next game at this table: the person takes the other colour, and the score carries over. */
  const nextGame = (game: Game, at: string, you?: Side) =>
    newGame({
      id: newId(),
      you: you ?? other(game.you),
      now: at,
      record: game.record,
      opponent: game.opponent,
    })

  return {
    read: async (seat: Seat): Promise<Game> => settle(seat, await (await storeFor(seat)).read()),

    // ── What a person does in the view ─────────────────────────────────────────────────────
    /** Play the move visiting `squares` (0–63, start first). */
    personMove: async (seat: Seat, squares: number[]) =>
      summon(seat, await update(seat, (game, at) => applyMove(game, squares, 'you', at))),
    /** The next game at this table, the person on `you` — else on the other colour. */
    newGame: async (seat: Seat, you?: Side) =>
      summon(seat, await update(seat, (game, at) => nextGame(game, at, you))),
    /** Ask the agent again for the move it owes. */
    remind: async (seat: Seat) => summon(seat, await (await storeFor(seat)).read(), true),
    /** Who plays the other colour from now on; a move it owes is asked of the new opponent at once. */
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
     * Play the move visiting `squares`. `answered` says whether the move answered the board's own
     * question — a wake was waiting on it — rather than a request typed in the chat.
     */
    agentMove: async (
      seat: Seat,
      squares: number[],
    ): Promise<{ game: Game; answered: boolean }> => {
      let answered = false
      const game = await update(seat, (current, at) => {
        if (current.opponent === 'decision') throw new MoveRefused(DECISION_HOLDS_SEAT)
        answered = current.waiting?.status === 'thinking'
        return applyMove(current, squares, 'agent', at)
      })
      return { game, answered }
    },
    /**
     * The next game at this table, the user on `you`. Against the decision model the user takes
     * white and opens: only a person's action asks that model, and a tool call is never one.
     */
    agentNewGame: (seat: Seat, you: Side) =>
      update(seat, (game, at) => nextGame(game, at, game.opponent === 'decision' ? 'white' : you)),
    /** Resign the game at this table: the user wins. Not while the decision model holds the seat. */
    agentResign: (seat: Seat) =>
      update(seat, (game) => {
        if (game.opponent === 'decision') throw new MoveRefused(DECISION_HOLDS_SEAT)
        return resign(game)
      }),
  }
}

export type GameService = ReturnType<typeof createGameService>
