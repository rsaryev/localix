/**
 * Where a typed query matches a displayed string — the ONE positional matcher behind every tiered
 * picker (slash menu, branch filter) AND every highlight (`MatchedText`).
 *
 * Highlights used to be recomputed by a separate greedy scan, so the characters lit up could
 * disagree with the reason a row ranked: `mit` ranked `commit` as a SUBSTRING (`co[mit]`) while the
 * highlight lit the first `m` (`co[m]m[it]`). Ranking and highlighting now read the same answer.
 *
 * Case folding is per UTF-16 code unit and LENGTH-PRESERVING. `String#toLowerCase` on a whole string
 * can change its length (`'İ'` → `'i̇'`, two units), which shifts every index after it, so a
 * position computed on the lowered string lit the wrong character of the original. Here each unit
 * folds to the first unit of its lowercase form, so index `i` of the fold is index `i` of the text.
 */

export type MatchKind = 'exact' | 'prefix' | 'substring' | 'subsequence'

export interface PositionalMatch {
  kind: MatchKind
  /** Index in `text` of the first matched character. */
  start: number
  /** Indices in `text` (the original, unfolded string) of every matched character. */
  positions: Set<number>
}

/** Length-preserving case fold: `foldCase(s).length === s.length`, index for index. */
export function foldCase(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const unit = text[i]!
    const lower = unit.toLowerCase()
    out += lower.length === 1 ? lower : (lower[0] ?? unit)
  }
  return out
}

function range(start: number, length: number): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < length; i++) out.add(start + i)
  return out
}

/**
 * Match `query` against `text`, case-insensitively, best kind first:
 * exact → prefix → substring (earliest occurrence) → subsequence (every query character in order,
 * whitespace in the query ignored, tightest span). `null` when the query is blank or does not match.
 */
export function positionalMatch(query: string, text: string): PositionalMatch | null {
  const needle = foldCase(query.trim())
  if (!needle) return null
  const haystack = foldCase(text)

  const at = haystack.indexOf(needle)
  if (at >= 0) {
    const kind: MatchKind =
      at > 0 ? 'substring' : needle.length === haystack.length ? 'exact' : 'prefix'
    return { kind, start: at, positions: range(at, needle.length) }
  }

  const compact = needle.replace(/\s+/g, '')
  const span = tightestSubsequence(haystack, compact)
  return span ? { kind: 'subsequence', start: span.start, positions: span.positions } : null
}

/** Matched character indices of `query` in `text`, or `null` — the highlight view of the match. */
export function matchPositions(query: string, text: string): Set<number> | null {
  return positionalMatch(query, text)?.positions ?? null
}

/** The in-order match of `needle` in `haystack` with the shortest span, if any. */
function tightestSubsequence(
  haystack: string,
  needle: string,
): { start: number; positions: Set<number> } | null {
  if (!needle) return null
  let best: { start: number; positions: Set<number>; span: number } | null = null
  for (
    let start = haystack.indexOf(needle[0]!);
    start >= 0;
    start = haystack.indexOf(needle[0]!, start + 1)
  ) {
    const positions = new Set<number>([start])
    let needleIndex = 1
    let end = start
    while (needleIndex < needle.length && ++end < haystack.length) {
      if (haystack[end] === needle[needleIndex]) {
        positions.add(end)
        needleIndex += 1
      }
    }
    if (needleIndex < needle.length) break // no later start can complete either
    const span = end - start
    if (!best || span < best.span) best = { start, positions, span }
  }
  return best && { start: best.start, positions: best.positions }
}
