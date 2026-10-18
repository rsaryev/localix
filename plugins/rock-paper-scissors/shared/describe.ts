import {
  theirMove,
  viewOwesAgentMove,
  type GameRecord,
  type PlayerView,
  type RoundView,
} from './game'

/**
 * The table as TEXT for the agent — tool results, the wake that asks for its move, and the context
 * the view publishes. Every sentence is built from a {@link PlayerView}, never from the stored game,
 * so no text can carry a move its reader may not see yet.
 */

/** The first characters of a digest — enough to compare by eye. */
export const shortDigest = (digest: string) => `${digest.slice(0, 8)}…`

/**
 * The running score at this table, from the agent's side — so a woken turn knows how this chat's
 * rounds went without reading them back from a transcript that checkpoints may have folded.
 */
export function recordLine(record: GameRecord): string | null {
  if (record.won + record.lost + record.draw === 0) return null
  return `Score at this table: you ${record.lost}, the user ${record.won}, draws ${record.draw}.`
}

/** A revealed round from the agent's seat: "Round 2: the user played rock, you played paper — you won." */
export function resultLine(round: RoundView): string | null {
  const theirs = theirMove(round)
  if (round.outcome === null || !round.mine || !theirs) return null
  const verdict =
    round.outcome === 'draw' ? 'a draw' : round.outcome === 'lost' ? 'you won' : 'the user won'
  return `Round ${round.number}: the user played ${theirs}, you played ${round.mine} — ${verdict}.`
}

/** Where the current round stands, from the agent's seat. Never names a sealed move. */
export function roundLine(view: PlayerView): string {
  const round = view.round
  if (round.outcome !== null) return resultLine(round) ?? `Round ${round.number} is over.`
  if (viewOwesAgentMove(view)) {
    if (round.theirs)
      return `Round ${round.number}: the user has sealed their move (digest ${shortDigest(round.theirs.digest)}). Your move.`
    return `Round ${round.number}: you open. Seal your move; the user sees only its digest until they have chosen.`
  }
  if (round.mine)
    return `Round ${round.number}: your move is sealed. The user chooses next; the round reveals both.`
  return `Round ${round.number}: the user opens. The board wakes you after they have chosen.`
}

/** Everything the agent needs to act. */
export function describeForAgent(view: PlayerView): string {
  const previous = view.round.outcome === null ? view.history.at(-1) : undefined
  return [
    'Rock Paper Scissors — the user against you.',
    recordLine(view.record),
    previous ? resultLine(previous) : null,
    roundLine(view),
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * The table as the PERSON sees it, for a message they send beside it — read by the agent, so it
 * names the person's own move only once the round has revealed it.
 */
export function describeForChat(view: PlayerView): string {
  const round = view.round
  const revealed = round.outcome !== null
  const theirs = theirMove(round)
  const lines = [`Rock Paper Scissors — round ${round.number}, the user against the agent.`]
  if (revealed && round.mine && theirs) {
    const verdict =
      round.outcome === 'draw'
        ? 'a draw'
        : round.outcome === 'won'
          ? 'the user won'
          : 'the agent won'
    lines.push(`The user played ${round.mine}, the agent played ${theirs} — ${verdict}.`)
  } else {
    lines.push(round.mine ? 'The user has chosen (sealed).' : 'The user has not chosen yet.')
    lines.push(round.theirs ? 'The agent’s move is sealed.' : 'The agent has not moved yet.')
  }
  const { won, lost, draw } = view.record
  if (won + lost + draw > 0) lines.push(`Score: the user ${won}, the agent ${lost}, draws ${draw}.`)
  return lines.join('\n')
}
