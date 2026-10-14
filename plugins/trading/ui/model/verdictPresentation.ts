import type { RatingVerdict } from './technicalRatings'

/** The verdict's words — tooltips and text rows. */
export const VERDICT_LABEL: Record<RatingVerdict, string> = {
  strong_sell: 'Strong sell',
  sell: 'Sell',
  neutral: 'Neutral',
  buy: 'Buy',
  strong_buy: 'Strong buy',
}

/** Verdict → dot tint: strong verdicts solid, weak ones dimmed, neutral faint. Shared by the
 *  Technicals timeframe strip and the Analyze popover so the two dots can never disagree. */
export const VERDICT_DOT: Record<RatingVerdict, string> = {
  strong_sell: 'bg-status-error',
  sell: 'bg-status-error/60',
  neutral: 'bg-text-faint/50',
  buy: 'bg-status-success/60',
  strong_buy: 'bg-status-success',
}
