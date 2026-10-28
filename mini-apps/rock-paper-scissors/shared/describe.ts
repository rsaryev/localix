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

/** A revealed round from the agent's side: "Round 2: the user played rock, you played paper — you won." */
export function resultLine(round: RoundView): string | null {
  const theirs = theirMove(round)
  if (round.outcome === null || !round.mine || !theirs) return null
  const verdict =
    round.outcome === 'draw' ? 'a draw' : round.outcome === 'lost' ? 'you won' : 'the user won'
  return `Round ${round.number}: the user played ${theirs}, you played ${round.mine} — ${verdict}.`
}

/** Where the current round stands, from the agent's side. Never names a sealed move. */
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

/** Who fills the other side, in the third person: "the agent", "the decision model". */
const opponentOf = (view: Pick<PlayerView, 'opponent'>) =>
  view.opponent === 'decision' ? 'the decision model' : 'the agent'

/** The score in neutral words, for a reader who does not play at this table. */
function neutralScore(view: PlayerView, them: string): string | null {
  const { won, lost, draw } = view.record
  if (won + lost + draw === 0) return null
  return `Score: the user ${won}, ${them} ${lost}, draws ${draw}.`
}

/**
 * Everything the agent needs to act. While the decision model holds the side, the agent does not
 * play: it is told so, with the score, and nothing about the round in play.
 */
export function describeForAgent(view: PlayerView): string {
  if (view.opponent === 'decision')
    return [
      'Rock Paper Scissors — the user against the decision model. You do not play at this table; the user can switch the opponent back to you on the table.',
      neutralScore(view, 'the decision model'),
    ]
      .filter((line) => line !== null)
      .join('\n')
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
  const them = opponentOf(view)
  const lines = [`Rock Paper Scissors — round ${round.number}, the user against ${them}.`]
  if (revealed && round.mine && theirs) {
    const verdict =
      round.outcome === 'draw' ? 'a draw' : round.outcome === 'won' ? 'the user won' : `${them} won`
    lines.push(`The user played ${round.mine}, ${them} played ${theirs} — ${verdict}.`)
  } else {
    lines.push(round.mine ? 'The user has chosen (sealed).' : 'The user has not chosen yet.')
    lines.push(
      round.theirs ? `${capital(them)}’s move is sealed.` : `${capital(them)} has not moved yet.`,
    )
  }
  const score = neutralScore(view, them)
  if (score) lines.push(score)
  return lines.join('\n')
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
