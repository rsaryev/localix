import type { GameRecord } from '../../shared/game'

/** The table's score as two numerals facing each other, with the round and draws beneath. */
export function Scoreboard({ record, round }: { record: GameRecord; round: number }) {
  const draws = record.draw === 1 ? '1 draw' : `${record.draw} draws`
  return (
    <div className="flex flex-col items-center gap-1">
      <p
        aria-label={`Score: you ${record.won}, the agent ${record.lost}`}
        className="flex items-baseline gap-4 tabular-nums"
      >
        <span className="text-xs text-text-faint">You</span>
        <span className="text-3xl font-semibold tracking-tight">{record.won}</span>
        <span className="text-text-faint">:</span>
        <span className="text-3xl font-semibold tracking-tight">{record.lost}</span>
        <span className="text-xs text-text-faint">Agent</span>
      </p>
      <p className="text-2xs text-text-faint">
        Round {round}
        {record.draw > 0 ? ` · ${draws}` : ''}
      </p>
    </div>
  )
}
