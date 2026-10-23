/**
 * FUNDING-RATE positioning read — mined from the Vibe-Trading perp-funding-basis skill: the
 * funding rate is crypto derivatives' most direct real-time positioning gauge (longs pay shorts
 * when positive), and its EXTREMES mark crowded sides that squeeze. The mined signal table,
 * normalized to an 8h-equivalent rate so venues with 1h funding read on the same scale:
 *
 *   8h rate      | annualized | state              | read
 *   > +0.05%     | > +55%     | extreme_long_crowding | contrarian — crowded longs squeeze down
 *   +0.02..0.05% | +22..55%   | elevated_long_bias    | caution; carry viable
 *   ±0.005..0.02%| ±5.5..22%  | mild bias             | lean, not a signal
 *   within ±0.005%| within ±5.5% | balanced           | no positioning edge
 *   < −0.02%     | < −22%     | short_squeeze_territory | contrarian — crowded shorts squeeze up
 *
 * Pure arithmetic over the venue's own reported rate + interval; a missing interval is NEVER
 * assumed to be 8h (the house rule) — the read abstains instead.
 */
import type { FundingRate } from '../contracts'

export interface FundingRead {
  /** The venue's rate normalized to an 8h-equivalent, in PERCENT (0.01 = 0.01%/8h). */
  ratePct8h: number
  /** Simple annualization: 8h rate × 3 × 365, percent. */
  annualizedPct: number
  state:
    | 'extreme_long_crowding'
    | 'elevated_long_bias'
    | 'mild_long_bias'
    | 'balanced'
    | 'mild_short_bias'
    | 'short_squeeze_territory'
}

/** Funding interval token → hours. Unknown/absent → null (never assume 8h). */
function intervalHours(interval: string | undefined): number | null {
  if (!interval) return null
  const m = /^(\d+)h$/.exec(interval)
  return m ? Number(m[1]) : null
}

/** The positioning read, or null when the venue did not report enough to normalize honestly. */
export function fundingRead(funding: FundingRate | null | undefined): FundingRead | null {
  if (!funding || !Number.isFinite(funding.rate)) return null
  const hours = intervalHours(funding.interval)
  if (hours === null || hours <= 0) return null
  const ratePct8h = funding.rate * (8 / hours) * 100
  const state: FundingRead['state'] =
    ratePct8h > 0.05
      ? 'extreme_long_crowding'
      : ratePct8h > 0.02
        ? 'elevated_long_bias'
        : ratePct8h > 0.005
          ? 'mild_long_bias'
          : ratePct8h >= -0.005
            ? 'balanced'
            : ratePct8h >= -0.02
              ? 'mild_short_bias'
              : 'short_squeeze_territory'
  return { ratePct8h, annualizedPct: ratePct8h * 3 * 365, state }
}

const STATE_NOTE: Record<FundingRead['state'], string> = {
  extreme_long_crowding:
    'EXTREME long crowding — longs pay heavily to stay in; crowded sides squeeze, a contrarian caution for fresh longs',
  elevated_long_bias: 'elevated long bias — longs paying up; carry viable, chasing is late',
  mild_long_bias: 'mild long bias — a lean, not a signal',
  balanced: 'balanced — no positioning edge either way',
  mild_short_bias: 'mild short bias — a lean, not a signal',
  short_squeeze_territory:
    'SHORT-SQUEEZE territory — shorts pay heavily to stay in; a squeeze up hurts the crowded side, a contrarian caution for fresh shorts',
}

/** The read as a report line — the normalized figures first, the positioning read after. */
export function renderFundingRead(f: FundingRead): string[] {
  const sign = f.ratePct8h >= 0 ? '+' : ''
  return [
    `- funding: ${sign}${f.ratePct8h.toFixed(4)}%/8h (≈${sign}${f.annualizedPct.toFixed(1)}% annualized, ` +
      `${f.ratePct8h >= 0 ? 'longs pay shorts' : 'shorts pay longs'}) — ${STATE_NOTE[f.state]}`,
  ]
}
