import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { FLEET } from '../../shared/rules'

/**
 * One side's fleet at a glance: a silhouette per ship, largest first, the sunk ones struck out —
 * the tally players keep beside a paper board. It takes only the SIZES of the ships sunk, which
 * is all either side knows about the other's losses.
 */
export function FleetTally({ label, sunkSizes }: { label: string; sunkSizes: readonly number[] }) {
  const remaining = [...sunkSizes]
  const ships = FLEET.map((size) => {
    const at = remaining.indexOf(size)
    if (at >= 0) remaining.splice(at, 1)
    return { size, sunk: at >= 0 }
  })
  const afloat = ships.filter((ship) => !ship.sunk).length
  return (
    <div
      className="flex items-center gap-2"
      aria-label={`${label}: ${afloat} of ${FLEET.length} afloat`}
    >
      <span className="text-xs font-medium tabular-nums text-text-soft">{afloat}</span>
      <span className="flex items-end gap-1" aria-hidden="true">
        {ships.map((ship, index) => (
          <span
            key={index}
            className={cn('bs-tally', ship.sunk && 'bs-tally-sunk')}
            style={{ width: `${ship.size * 7}px` }}
          />
        ))}
      </span>
    </div>
  )
}
