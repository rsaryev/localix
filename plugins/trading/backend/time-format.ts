/**
 * Pure time formatting shared across the workbench. Lives in `backend/` because BOTH the UI chart
 * header and the agent's `market_data` tool render a funding countdown, and neither may import the
 * other — a countdown that read differently between the human and the agent would be one more place
 * to disagree about when a position starts costing money.
 */

/**
 * Time until a funding settlement, as `1h 07m` / `07m 12s` / `12s`.
 *
 * A funding rate without a countdown asks the reader to compute it from a timestamp. `null` when the
 * settlement time is unknown or already past — a stale "in 0s" is worse than no countdown.
 */
export function formatCountdown(msRemaining: number): string | null {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return null
  const total = Math.floor(msRemaining / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}
