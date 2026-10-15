/**
 * WHERE the last price sits inside the detected structure — the nearest support below and the
 * nearest resistance above, with their distances, and the room ratio between them. The single most
 * actionable read for an entry/stop: a price hugging support with a lot of room to resistance is a
 * different trade from one pinned under resistance. Pure over the levels the scan already found.
 */
import type { PriceLevel } from './pattern-detect'
import { toolNumber } from '../tool-number'

export interface StructurePosition {
  /** Nearest level at or below the price (the support in play), or null if none is below. */
  support: PriceLevel | null
  /** Nearest level at or above the price (the resistance in play), or null if none is above. */
  resistance: PriceLevel | null
  /** Percent distance DOWN to support / UP to resistance (positive; null when that side is empty). */
  supportPct: number | null
  resistancePct: number | null
}

/** The nearest bracketing levels around `price`, from the detected level set. */
export function structurePosition(levels: PriceLevel[], price: number): StructurePosition {
  if (!(price > 0))
    return { support: null, resistance: null, supportPct: null, resistancePct: null }
  let support: PriceLevel | null = null
  let resistance: PriceLevel | null = null
  for (const level of levels) {
    if (level.price <= price) {
      if (!support || level.price > support.price) support = level
    } else if (!resistance || level.price < resistance.price) {
      resistance = level
    }
  }
  return {
    support,
    resistance,
    supportPct: support ? ((price - support.price) / price) * 100 : null,
    resistancePct: resistance ? ((resistance.price - price) / price) * 100 : null,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/**
 * The position as a report line — "1.2% above support X, 2.4% below resistance Y (room R:S ≈ 2.0)".
 * The room ratio is resistance-distance ÷ support-distance: how much a long has to run versus how
 * far its structure stop sits. Renders nothing when neither side has a level.
 */
export function renderStructurePosition(pos: StructurePosition, price: number): string[] {
  const parts: string[] = []
  if (pos.support && pos.supportPct !== null) {
    parts.push(`${toolNumber(pos.supportPct)}% above support ${toolNumber(pos.support.price)}`)
  }
  if (pos.resistance && pos.resistancePct !== null) {
    parts.push(
      `${toolNumber(pos.resistancePct)}% below resistance ${toolNumber(pos.resistance.price)}`,
    )
  }
  if (parts.length === 0) return []
  let room = ''
  if (pos.supportPct && pos.resistancePct && pos.supportPct > 0) {
    room = ` (room to resistance vs support ≈ ${toolNumber(pos.resistancePct / pos.supportPct)}:1)`
  }
  return [`- position (last ${toolNumber(price)}): ${parts.join(', ')}${room}`]
}
