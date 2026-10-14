/**
 * Compact, muted rendering of an APPROXIMATE row count for the schema browser.
 * Under 1,000 → the exact integer (`950`); from 1,000 up → a `~`-prefixed short
 * form with a k/M/B unit and one decimal (`~1.2k`, `~3.4M`, `~2.1B`). The tilde
 * signals "approximate" — these come from engine statistics, not `COUNT(*)`.
 */
export function formatApproxCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n < 1000) return String(Math.round(n))
  const units: Array<readonly [number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]
  for (const [value, suffix] of units) {
    if (n >= value) {
      const scaled = n / value
      // ≥100 in the unit reads better as a whole number (`~123k`); below that keep
      // one decimal (`~1.2k`), trimming a trailing `.0` (`~1k`, not `~1.0k`).
      const label =
        scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '')
      return `~${label}${suffix}`
    }
  }
  return String(n)
}
