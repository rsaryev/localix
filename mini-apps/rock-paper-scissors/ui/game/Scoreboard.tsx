import type { GameRecord } from '../../shared/game'

/** The table's score as two numerals facing each other; the round and draws are in the status. */
export function Scoreboard({
  record,
  opponent = 'Agent',
}: {
  record: GameRecord
  /** The other side's short name. */
  opponent?: string
}) {
  return (
    <p
      aria-label={`Score: you ${record.won}, ${opponent.toLowerCase()} ${record.lost}`}
      className="flex items-baseline gap-4 tabular-nums"
    >
      <span className="text-xs text-text-faint">You</span>
      <span className="text-3xl font-semibold tracking-tight">{record.won}</span>
      <span className="text-text-faint">:</span>
      <span className="text-3xl font-semibold tracking-tight">{record.lost}</span>
      <span className="text-xs text-text-faint">{opponent}</span>
    </p>
  )
}
