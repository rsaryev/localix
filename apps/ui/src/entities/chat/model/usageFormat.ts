// Pure display formatters for the usage indicator (token counts + cost),
// extracted from UsageIndicator so the threshold/rounding logic is testable.

/** Compact token count: 999 / 1.5k / 2.5m. */
export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  return String(value)
}

const costFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

/** Cost in USD: sub-tenth-cent collapses to a threshold label, small amounts get
 *  4 decimals, the rest use the currency formatter. */
export function formatCost(usd: number): string {
  if (usd < 0.00005) return '< $0.0001'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return costFormatter.format(usd)
}
