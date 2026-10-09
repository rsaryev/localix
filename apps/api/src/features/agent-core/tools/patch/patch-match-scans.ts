import { blockSimilarity, levenshtein } from './patch-distance'
import type { MatchCandidate } from './patch-match-contracts'

/** Scan for windows where every line matches the pattern under `normalize`. */
export function scanLines(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  normalize: (value: string) => string,
  limit: number,
): MatchCandidate[] {
  if (pattern.length === 0 || pattern.length > lines.length) return []
  const maxStart = lines.length - pattern.length
  const searchStart = eof ? maxStart : start
  if (searchStart > maxStart) return []
  const normPattern = pattern.map((p) => normalize(p ?? ''))
  const out: MatchCandidate[] = []
  for (let i = searchStart; i <= maxStart && out.length < limit; i += 1) {
    let ok = true
    for (let j = 0; j < pattern.length; j += 1) {
      if (normalize(lines[i + j] ?? '') !== normPattern[j]) {
        ok = false
        break
      }
    }
    if (ok) out.push({ index: i, length: pattern.length })
  }
  return out
}

/** Strip the block's common minimum indentation (blank lines ignored); trimEnd per line. */
function stripCommonIndent(block: string[]): string[] {
  const nonEmpty = block.filter((l) => l.trim().length > 0)
  if (nonEmpty.length === 0) return block.map(() => '')
  const minIndent = Math.min(...nonEmpty.map((l) => (l.match(/^[ \t]*/)?.[0] ?? '').length))
  return block.map((l) => (l.trim().length === 0 ? '' : l.slice(minIndent).trimEnd()))
}

/**
 * Indentation-flexible matching:
 * compare blocks after removing each side's common minimum indentation, so a
 * uniformly shifted block matches while relative indentation still must agree --
 * stricter than per-line trim, which is why it sits before it in the ladder.
 */
export function scanIndentFlexible(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  limit: number,
): MatchCandidate[] {
  if (pattern.length === 0 || pattern.length > lines.length) return []
  const maxStart = lines.length - pattern.length
  const searchStart = eof ? maxStart : start
  if (searchStart > maxStart) return []
  const target = stripCommonIndent(pattern).join('\n')
  const out: MatchCandidate[] = []
  for (let i = searchStart; i <= maxStart && out.length < limit; i += 1) {
    const window = lines.slice(i, i + pattern.length)
    if (stripCommonIndent(window).join('\n') === target)
      out.push({ index: i, length: pattern.length })
  }
  return out
}

/**
 * Block-anchor candidates: anchor on the first + last (trimmed) pattern lines
 * and score each candidate region's middle similarity. Regions may have a
 * different length than the pattern. Heavily gated (size ratio + similarity)
 * because a lone first/last-line coincidence is exactly how block-anchor
 * misapplies. Returns gated candidates, best score first.
 */
export function blockAnchorCandidates(
  lines: string[],
  pattern: string[],
  start: number,
  _eof: boolean,
  limit: number,
): MatchCandidate[] {
  if (pattern.length < 3) return []
  const first = pattern[0].trim()
  const last = pattern[pattern.length - 1].trim()
  if (!first || !last) return []
  const candidates: Array<{ index: number; length: number; score: number }> = []
  for (let i = start; i < lines.length; i++) {
    if ((lines[i] ?? '').trim() !== first) continue
    for (let j = i + 2; j < lines.length; j++) {
      if ((lines[j] ?? '').trim() !== last) continue
      const region = lines.slice(i, j + 1)
      const score = blockSimilarity(region, pattern)
      candidates.push({ index: i, length: region.length, score })
      break
    }
  }
  const gated = candidates.filter((c) => {
    const sizeRatio = Math.min(c.length, pattern.length) / Math.max(c.length, pattern.length)
    return sizeRatio >= 0.75 && c.score >= 0.5
  })
  gated.sort((a, b) => b.score - a.score)
  return gated.slice(0, limit).map(({ index, length }) => ({ index, length }))
}

/**
 * Fuzzy candidates: Levenshtein over the joined window with a tight 5%
 * threshold -- fuzzy is the last resort and a loose budget is exactly how a
 * near-duplicate block elsewhere gets matched instead of the intended one.
 * Overlapping hit windows are merged into one region (keeping the best
 * distance), so two adjacent windows over the same block never count as two
 * occurrences. Returns regions sorted by distance, best first.
 */
export function fuzzyCandidates(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  limit: number,
): MatchCandidate[] {
  if (pattern.length === 0 || pattern.length > lines.length) return []
  const needle = pattern.join('\n').trim()
  if (needle.length < 16) return [] // too short to fuzzy-match safely
  const maxStart = lines.length - pattern.length
  const searchStart = eof ? maxStart : start
  if (searchStart > maxStart) return []
  const threshold = Math.ceil(needle.length * 0.05)
  const regions: Array<{ index: number; dist: number }> = []
  for (let i = searchStart; i <= maxStart; i++) {
    const hay = lines
      .slice(i, i + pattern.length)
      .join('\n')
      .trim()
    const dist = levenshtein(hay, needle, threshold)
    if (dist > threshold) continue
    const lastRegion = regions[regions.length - 1]
    if (lastRegion && i < lastRegion.index + pattern.length) {
      if (dist < lastRegion.dist) {
        lastRegion.index = i
        lastRegion.dist = dist
      }
    } else {
      regions.push({ index: i, dist })
    }
  }
  regions.sort((a, b) => a.dist - b.dist)
  return regions.slice(0, limit).map((r) => ({ index: r.index, length: pattern.length }))
}
