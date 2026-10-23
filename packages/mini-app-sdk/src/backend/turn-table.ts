import type { z } from 'zod'

import type { AgentWait } from '../agent-wait'
import { DECISION_HOLDS_SEAT, defaultOpponent, type Opponent } from '../opponent'
import { askAgentForTurn, decisionTurns, type Seat, type Wake } from './agent-turn'
import type { DecisionHost } from './decision'
import { openJsonStore } from './json-store'

/** What every turn game keeps beside its rules: who plays the other side, and the wait shown. */
export interface TurnGameState {
  opponent: Opponent | null
  waiting?: AgentWait | null
}

/** The hosts a game's backend load hands its table; only the backend load carries wake/decisions. */
export interface TurnTableHosts {
  /** The session's folder for this plugin; rejects for a session the user does not own. */
  resolveDir?: (userId: string, sessionId: string) => Promise<string>
  /** `ctx.host.wake` — present on the backend load, where the routes live. */
  wake?: Wake
  /** `ctx.host.decisions` — the decision model, on the backend load too. */
  decisions?: DecisionHost
}

export interface TurnTableOptions<G extends TurnGameState, A> extends TurnTableHosts {
  /** The plugin's name, for the decision model's failed-turn log. */
  plugin: string
  /** What the game is called when there is nowhere to keep it: "board", "table". */
  noun: string
  now: () => string
  schema: z.ZodType<G>
  /** A fresh game, for a chat that has none yet. */
  initial: () => G
  /** Whether the other side owes a turn now. */
  owes: (game: G) => boolean
  /** The position's identity: one wake per key, and an answer only for the key it was asked. */
  key: (game: G) => string
  /** Whether a game is still the one that owes the turn asked for (playing, or the round open). */
  live: (game: G) => boolean
  /**
   * What the woken chat reads for the agent's turn, and the tools that answer it. The wake is
   * delivered once per position: its key is {@link key}, so a double click, a retried request and
   * a reminder for the same position are the same wake.
   */
  agentTurn: (game: G) => { message: string; tools: string[] }
  /** Ask the decision model for its turn; a `waiting` when it gave none. */
  askDecision: (
    decisions: DecisionHost | undefined,
    seat: Seat,
    game: G,
    now: string,
  ) => Promise<A | { waiting: AgentWait }>
  /** Play the decision model's answer on the game. */
  playDecision: (game: G, answer: A, at: string) => G
  /** How many turns the decision model may play in a row while it keeps the seat (a hit). */
  maxDecisionTurns?: number
  /** The game's own refusal, for the agent acting while the decision model holds its seat. */
  refuse: (message: string) => Error
}

/**
 * THE GAME AT EACH CHAT'S TABLE, and the turn-taking every agent-opponent game shares.
 *
 * One game per chat session, kept in that session's own folder (`resolveDir`, the host's session
 * storage). Every operation names its seat and resolves the folder AGAIN, through the host's
 * ownership check: a session that was deleted rejects before anything is read or written.
 *
 * A PERSON acts in the view (`personTurn`), and after that the other side may owe a turn, so it is
 * asked — once per position (`key`), unless `remind` asks again. Who answers depends on the
 * table's `opponent`: the agent is woken and answers with its tool later (`agentTurn`); the
 * decision model is asked here, after the person's request has answered with the model thinking
 * (`decisionTurns`), and its turn lands through the store feed. The AGENT acting through its tools
 * is never asked for anything: a tool that woke the agent would wake it again on every move.
 */
export function createTurnTable<G extends TurnGameState, A>(options: TurnTableOptions<G, A>) {
  const { now, key, live, owes } = options

  const storeFor = async (seat: Seat) => {
    if (!options.resolveDir)
      throw new Error(`This app keeps no per-chat data, so it cannot hold a ${options.noun}.`)
    return openJsonStore({
      dir: await options.resolveDir(seat.userId, seat.sessionId),
      file: 'game.json',
      schema: options.schema,
      initial: options.initial(),
    })
  }

  const read = async (seat: Seat) => (await storeFor(seat)).read()

  const update = async (seat: Seat, change: (game: G, at: string) => G) =>
    (await storeFor(seat)).update((current) => change(current, now()))

  /**
   * A table whose opponent is not settled takes the default now: the decision model when it can
   * answer, else the agent. Only the backend load can ask (`decisions`); a tool call leaves it.
   */
  const settle = async (seat: Seat, game: G): Promise<G> => {
    if (game.opponent !== null || !options.decisions) return game
    const opponent = await defaultOpponent(options.decisions, seat.userId)
    return update(seat, (current) =>
      current.opponent === null ? { ...current, opponent } : current,
    )
  }

  const turns = decisionTurns(options.plugin)

  /**
   * The decision model's turns while the table owes one, each written as it lands and only while
   * the table still shows the position it was asked about. Read fresh: a turn queued behind
   * another finds the table as it is now.
   */
  const decisionTurn = async (seat: Seat): Promise<void> => {
    let current = await read(seat)
    const most = options.maxDecisionTurns ?? 1
    for (let turn = 0; turn < most && current.opponent === 'decision' && owes(current); turn++) {
      const asked = key(current)
      const answer = await options.askDecision(options.decisions, seat, current, now())
      const next = await update(seat, (latest, at) =>
        key(latest) !== asked || !live(latest) || latest.opponent !== 'decision'
          ? latest
          : isWaiting(answer)
            ? { ...latest, waiting: answer.waiting }
            : options.playDecision(latest, answer, at),
      )
      if (isWaiting(answer) || key(next) === asked) return
      current = next
    }
  }

  /**
   * After a person's action: ask for the turn now owed, unless it has been asked for this position
   * already (`again` is the reminder that asks anyway). The answer is recorded only while the
   * table still shows that position — the agent may have moved before it arrived.
   */
  const summon = async (seat: Seat, settled: G, again = false): Promise<G> => {
    const game = await settle(seat, settled)
    if (!owes(game) || (game.waiting?.status === 'thinking' && !again)) return game
    const asked = key(game)
    const unchanged = (latest: G) => key(latest) === asked && live(latest)
    if (game.opponent === 'decision') {
      // Answer the person now, with the model thinking; its turn lands through the store feed.
      const thinking = await update(seat, (latest, at) =>
        unchanged(latest) && latest.opponent === 'decision'
          ? { ...latest, waiting: { since: at, status: 'thinking' } }
          : latest,
      )
      turns.start(seat, () => decisionTurn(seat))
      return thinking
    }
    const turn = { ...options.agentTurn(game), key: asked }
    const waiting = await askAgentForTurn(options.wake, seat, turn, now())
    return update(seat, (latest) => (unchanged(latest) ? { ...latest, waiting } : latest))
  }

  /** A change the agent makes through its tools: refused while the decision model holds its seat. */
  const agentUpdate = (seat: Seat, change: (game: G, at: string) => G) =>
    update(seat, (game, at) => {
      if (game.opponent === 'decision') throw options.refuse(DECISION_HOLDS_SEAT)
      return change(game, at)
    })

  return {
    /** Resolves once the decision model's turns started so far have landed — for tests. */
    settled: turns.idle,
    read: async (seat: Seat): Promise<G> => settle(seat, await read(seat)),
    /** A change nobody is asked about: a tool's new game, a fleet placed anew. */
    update,
    /** What a person does in the view; then the other side is asked for the turn it owes. */
    personTurn: async (seat: Seat, change: (game: G, at: string) => G) =>
      summon(seat, await update(seat, change)),
    /** Ask again for the turn owed. */
    remind: async (seat: Seat) => summon(seat, await read(seat), true),
    /** Who plays the other side from now on; a turn it owes is asked of the new opponent at once. */
    setOpponent: async (seat: Seat, opponent: Opponent) =>
      summon(
        seat,
        await update(seat, (game) =>
          game.opponent === opponent ? game : { ...game, opponent, waiting: null },
        ),
        true,
      ),
    agentUpdate,
    /**
     * The agent's turn. `answered` says whether it answered the table's own question — a wake was
     * waiting on it — rather than a request typed in the chat.
     */
    agentTurn: async (
      seat: Seat,
      play: (game: G, at: string) => G,
    ): Promise<{ game: G; answered: boolean }> => {
      let answered = false
      const game = await agentUpdate(seat, (current, at) => {
        answered = current.waiting?.status === 'thinking'
        return play(current, at)
      })
      return { game, answered }
    },
  }
}

export type TurnTable<G extends TurnGameState, A = unknown> = ReturnType<
  typeof createTurnTable<G, A>
>

const isWaiting = <A>(answer: A | { waiting: AgentWait }): answer is { waiting: AgentWait } =>
  typeof answer === 'object' && answer !== null && 'waiting' in answer
