import type { RatingGroup, RatingVerdict, TechnicalRatings } from './technicalRatings'

const VERDICT_TEXT: Record<RatingVerdict, string> = {
  strong_sell: 'STRONG SELL',
  sell: 'SELL',
  neutral: 'NEUTRAL',
  buy: 'BUY',
  strong_buy: 'STRONG BUY',
}

const num = (v: number | null): string =>
  v === null ? '—' : Math.abs(v) >= 1000 ? v.toFixed(1) : String(Number(v.toPrecision(4)))

/**
 * The ratings as agent-readable text — what a linked Technicals tab hands into chat context.
 * Same numbers the page shows: the three gauge verdicts with their counts, then both vote tables
 * row by row (name, value, action). Pure, so the handoff is testable.
 */
export function renderTechnicalRatingsText(
  symbol: string,
  timeframe: string,
  r: TechnicalRatings,
): string {
  const gauge = (title: string, g: RatingGroup) =>
    `${title}: ${VERDICT_TEXT[g.verdict]} (${g.sells} sell / ${g.neutrals} neutral / ${g.buys} buy)`
  const table = (title: string, g: RatingGroup) => [
    `${title}:`,
    ...g.rows.map(
      (row) =>
        `- ${row.name}: ${num(row.value)} → ${row.action === null ? '—' : row.action.toUpperCase()}`,
    ),
  ]
  return [
    `Technical rating for ${symbol} on ${timeframe} (textbook voting rules over the loaded candles):`,
    gauge('Summary', r.summary),
    gauge('Oscillators', r.oscillators),
    gauge('Moving averages', r.movingAverages),
    '',
    ...table('Oscillator votes', r.oscillators),
    '',
    ...table('Moving-average votes', r.movingAverages),
  ].join('\n')
}
