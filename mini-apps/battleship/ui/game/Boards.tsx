import { useMemo, useRef, type ReactNode } from 'react'

import { owesAgentShot, shotsBy, type PlayerView } from '../../shared/game'
import { sunkShips } from '../../shared/rules'
import { enemyBoard, ownBoard } from './cells'
import { useShotArrivals } from './Effects'
import { FleetTally } from './FleetTally'
import { Grid } from './Grid'
import { BOARD_GAP, HEADING, STATUS_ROW, pairWidth, useBoardLayout } from './layout'

/**
 * The two boards side by side, as large as the pane allows: the agent's waters on the left, where
 * the person fires, and their own fleet on the right, where the agent does. The space is MEASURED
 * (`useBoardLayout`), so the tiles grow with the pane instead of sitting small in its middle.
 *
 * The board where the action is carries a quiet outline: the agent's waters on the person's turn,
 * their own fleet while the agent aims. `overlay` (the problem and result cards) sits over the
 * pair, so the position stays visible behind it.
 */
export function Boards({
  view,
  playable,
  onFire,
  status,
  overlay,
}: {
  view: PlayerView
  /** Whether the person may fire now. */
  playable: boolean
  onFire: (cell: number) => void
  /** The control row, set right above the pair and as wide as it — as in the other games. */
  status: ReactNode
  overlay?: ReactNode
}) {
  const space = useRef<HTMLDivElement>(null)
  const cell = useBoardLayout(space)
  const arrivals = useShotArrivals(view)

  const boards = useMemo(() => {
    const atEnemy = shotsBy(view, 'you')
    const atOwn = shotsBy(view, 'agent')
    const last = view.shots.at(-1)
    return {
      enemy: enemyBoard(view),
      own: ownBoard(view),
      firedAtEnemy: new Set(atEnemy),
      firedAtOwn: new Set(atOwn),
      enemySunk: sunkShips(view.enemySeen, atEnemy).map((ship) => ship.cells.length),
      ownSunk: sunkShips(view.fleet, atOwn).map((ship) => ship.cells.length),
      lastAtEnemy: last?.by === 'you' ? last.cell : null,
      lastAtOwn: last?.by === 'agent' ? last.cell : null,
    }
  }, [view])

  const playing = view.status === 'playing'
  const heading = (title: string, tally: ReactNode) => (
    <div className="flex items-center justify-between gap-3" style={{ height: HEADING }}>
      <h2 className="text-sm font-medium text-text-soft">{title}</h2>
      {tally}
    </div>
  )

  return (
    <div ref={space} className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
      <div className="flex items-center" style={{ width: pairWidth(cell), height: STATUS_ROW }}>
        {status}
      </div>
      <div className="relative flex items-start justify-center" style={{ gap: BOARD_GAP }}>
        <section className="flex flex-col">
          {heading(
            'The agent’s waters',
            <FleetTally label="The agent’s fleet" sunkSizes={boards.enemySunk} />,
          )}
          <Grid
            label="The agent’s waters"
            cells={boards.enemy}
            fired={boards.firedAtEnemy}
            last={boards.lastAtEnemy}
            arrivals={arrivals.filter(({ shot }) => shot.by === 'you')}
            cell={cell}
            active={playing && view.turn === 'you'}
            playable={playable}
            onFire={onFire}
          />
        </section>
        <section className="flex flex-col">
          {heading('Your fleet', <FleetTally label="Your fleet" sunkSizes={boards.ownSunk} />)}
          <Grid
            label="Your fleet"
            cells={boards.own}
            fired={boards.firedAtOwn}
            last={boards.lastAtOwn}
            arrivals={arrivals.filter(({ shot }) => shot.by === 'agent')}
            cell={cell}
            active={playing && owesAgentShot(view)}
          />
        </section>
        {overlay}
      </div>
    </div>
  )
}
