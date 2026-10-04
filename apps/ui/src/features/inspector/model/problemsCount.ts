import type { LspDiagnostic } from '@/shared/api/contracts'

// 1=Error 2=Warning 3=Info 4=Hint (LSP). Undefined severity is treated as Error.
export const severityRank = (s?: number) => s ?? 1
// Filter bucket: hints (4) fold into the Info bucket so there are three buckets.
export const severityBucket = (s?: number) => (severityRank(s) >= 3 ? 3 : severityRank(s))

export interface ProblemCounts {
  errors: number
  warnings: number
}

/**
 * Total error + warning counts across every open file's diagnostics (the map the
 * Problems panel renders — `session.lspDiagnostics` keyed by absolute path).
 * Drives the Problems tab count badge; info/hints are excluded (they don't warrant
 * an attention badge; the badge shows errors plus warnings).
 */
export function problemCounts(byFile?: Record<string, LspDiagnostic[]> | null): ProblemCounts {
  let errors = 0
  let warnings = 0
  for (const diags of Object.values(byFile ?? {})) {
    for (const d of diags ?? []) {
      const bucket = severityBucket(d.severity)
      if (bucket === 1) errors++
      else if (bucket === 2) warnings++
    }
  }
  return { errors, warnings }
}

/** The tab badge for a diagnostics map: total err+warn count with an error/warn
 *  tone, or null when there is nothing to flag (badge hidden). */
export function problemBadge(
  byFile?: Record<string, LspDiagnostic[]> | null,
): { count: number; tone: 'error' | 'warn' } | null {
  const { errors, warnings } = problemCounts(byFile)
  const count = errors + warnings
  if (count === 0) return null
  return { count, tone: errors > 0 ? 'error' : 'warn' }
}
