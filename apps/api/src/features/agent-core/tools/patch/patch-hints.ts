// Not-found / repair-diagnosis HINT builders for apply_patch. When a
// pattern can't be located, these quote the REAL file lines near the closest
// region and diagnose the two weak-model mistakes apply_patch can't auto-repair,
// so the model fixes its match text in one retry without a read round-trip. Pure
// string logic, no IO — extracted from patch-match.ts (which owns MATCHING).

import { blockSimilarity, levenshtein } from './patch-distance'

/**
 * 1-based line number of the region that best matches the pattern, for error
 * hints. Multi-line patterns score whole windows (count of trimmed-equal lines),
 * so a generic first line ("}", "async (c) => {") can't drag the hint to the
 * wrong place; single-line patterns (or all-zero window scores) fall back to
 * first-line Levenshtein.
 */
export function closestLineHint(lines: string[], pattern: string[]): number | null {
  const target = (pattern[0] ?? '').trim()
  if (!target) return null
  if (pattern.length > 1 && lines.length >= pattern.length) {
    let bestIdx: number | null = null
    let bestScore = 0
    for (let i = 0; i + pattern.length <= lines.length; i++) {
      const score = blockSimilarity(lines.slice(i, i + pattern.length), pattern)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx !== null) return bestIdx + 1
  }
  let bestIdx: number | null = null
  let bestDist = Infinity
  const cap = Math.max(4, Math.ceil(target.length * 0.5))
  for (let i = 0; i < lines.length; i++) {
    const d = levenshtein((lines[i] ?? '').trim(), target, cap)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx === null ? null : bestIdx + 1
}

/**
 * "context not found" hint for apply_patch: locate the closest
 * region and quote the REAL file lines around it, sized to the pattern (a
 * 12-line old_string gets the full candidate block, not a 7-line keyhole) so
 * the model can fix its match text in one retry without a read round-trip.
 */
export function buildNotFoundHint(lines: string[], oldLines: string[]): string {
  const near = closestLineHint(lines, oldLines)
  if (!near) return ''
  // ±10 lines around the candidate (capped): wide enough that the lines the model
  // MEANT are usually inside the excerpt even when its context drifted, so the
  // retry needs no read round-trip.
  const margin = 10
  const span = Math.min(oldLines.length + margin * 2, 60)
  const lo = Math.max(0, near - 1 - margin)
  const hi = Math.min(lines.length, lo + span)
  return (
    `\nClosest match is near line ${near}.` +
    `\nActual lines ${lo + 1}-${hi} of the file's CURRENT content (copy from here, verbatim):\n` +
    lines
      .slice(lo, hi)
      .map((l, i) => `${lo + i + 1}\t${l}`)
      .join('\n')
  )
}

/**
 * One-line diagnosis tuned to the shape of a not-found chunk, so the model fixes
 * the right mistake on retry. Detects the two weak-model errors apply_patch repairs
 * when unambiguous but must name when it can't: a line repeated as both context and
 * a '-' removal, and a real file line split into several patch fragments. Returns ''
 * when neither shape is present (keeps the generic hint clean).
 */
export function buildRepairDiagnosis(lines: string[], oldLines: string[]): string {
  for (let i = 1; i < oldLines.length; i += 1) {
    if (oldLines[i] === oldLines[i - 1] && oldLines[i].trim() !== '') {
      return (
        `\nDiagnosis: you repeated the line "${oldLines[i].trim()}" as BOTH a context line and a "-" line — ` +
        'a line can be one or the other, not both. Remove the duplicate.'
      )
    }
  }
  // Diagnose a split line only when rejoining the WHOLE requested block actually
  // reconstructs a file line. The old per-fragment check produced false diagnoses:
  // any stale multi-line block containing a common fragment such as a generic type
  // was blamed on line splitting even when its identifier also differed.
  if (oldLines.length >= 2) {
    const joined = oldLines.join(' ').trim()
    if (joined.length >= 3 && lines.some((line) => line.trim() === joined)) {
      return (
        `\nDiagnosis: the requested ${oldLines.length}-line block is one whole file line, not separate lines. ` +
        'Edit the whole line with one "-" line and one "+" line.'
      )
    }
  }

  const near = closestLineHint(lines, oldLines)
  if (!near) return ''
  const start = near - 1
  let equalPrefix = 0
  while (
    equalPrefix < oldLines.length &&
    start + equalPrefix < lines.length &&
    (oldLines[equalPrefix] ?? '').trim() === (lines[start + equalPrefix] ?? '').trim()
  ) {
    equalPrefix += 1
  }

  const requested = oldLines[equalPrefix]
  const current = lines[start + equalPrefix]
  if (equalPrefix > 0 && requested !== undefined && current !== undefined) {
    return (
      `\nDiagnosis: the first ${equalPrefix} requested line(s) match at file line ${near}, but the next line differs.` +
      `\nRequested: ${quoteDiagnosticLine(requested)}` +
      `\nCurrent:   ${quoteDiagnosticLine(current)}`
    )
  }

  // When the very first line drifted, show the concrete whole-line difference only
  // if the candidate is genuinely similar. This catches stale identifiers without
  // presenting an unrelated nearest line as a confident diagnosis.
  if (requested !== undefined && current !== undefined) {
    // A model may have wrapped one declaration across several patch lines. Compare
    // their joined form to the closest real line so a stale identifier is surfaced;
    // the strict split-line diagnosis above still requires an exact joined match.
    const requestedComparison = oldLines.length > 1 ? oldLines.join(' ') : requested
    const requestedTrimmed = requestedComparison.trim()
    const currentTrimmed = current.trim()
    const maxLength = Math.max(requestedTrimmed.length, currentTrimmed.length)
    const threshold = Math.max(4, Math.ceil(maxLength * 0.35))
    if (levenshtein(requestedTrimmed, currentTrimmed, threshold) <= threshold) {
      return (
        '\nDiagnosis: the closest whole file line differs from the requested line.' +
        `\nRequested: ${quoteDiagnosticLine(requestedComparison)}` +
        `\nCurrent:   ${quoteDiagnosticLine(current)}`
      )
    }
  }
  return ''
}

function quoteDiagnosticLine(line: string): string {
  const limit = 240
  const value = line.length > limit ? `${line.slice(0, limit)}…` : line
  return JSON.stringify(value)
}
