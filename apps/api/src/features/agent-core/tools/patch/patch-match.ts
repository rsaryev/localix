// Fuzzy text-matching engine for apply_patch: locates a pattern block in
// a file via a strictest-first ladder of strategies (exact → trailing-ws →
// indentation → trimmed → punctuation → whitespace-normalized → block-anchor →
// levenshtein fuzzy). Pure string logic, no IO — extracted from patch.ts so that
// file owns patch PARSING + APPLICATION and this one owns MATCHING. Distance
// primitives live in patch-distance.ts; the not-found HINT builders live in
// patch-hints.ts and are re-exported here for existing importers.

import { blockSimilarity, levenshtein } from './patch-distance'

export { buildNotFoundHint, buildRepairDiagnosis, closestLineHint } from './patch-hints'

function normalizeUnicode(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ')
}

interface MatchCandidate {
  index: number
  length: number
}

/** Scan for windows where every line matches the pattern under `normalize`. */
function scanLines(
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
function scanIndentFlexible(
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

function leadingWs(s: string): string {
  return s.match(/^[ \t]*/)?.[0] ?? ''
}

/**
 * When a match was found by a non-exact strategy, the replacement lines were
 * written with the pattern's indentation, which may differ from the file's.
 * Shift every inserted line by the delta between the pattern's first old line and
 * the actual matched file line so the block lands at the file's indentation.
 */
export function reindentNewLines(
  newLines: string[],
  oldFirst: string,
  fileFirst: string,
): string[] {
  const oldIndent = leadingWs(oldFirst)
  const fileIndent = leadingWs(fileFirst)
  if (oldIndent === fileIndent) return newLines
  return newLines.map((line) => {
    if (line.trim() === '') return line
    const stripped = line.startsWith(oldIndent)
      ? line.slice(oldIndent.length)
      : line.replace(/^[ \t]*/, '')
    return fileIndent + stripped
  })
}

/**
 * Block-anchor candidates: anchor on the first + last (trimmed) pattern lines
 * and score each candidate region's middle similarity. Regions may have a
 * different length than the pattern. Heavily gated (size ratio + similarity)
 * because a lone first/last-line coincidence is exactly how block-anchor
 * misapplies. Returns gated candidates, best score first.
 */
function blockAnchorCandidates(
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
function fuzzyCandidates(
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

const ESCAPE_MAP: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  f: '\f',
  v: '\v',
  '0': '\0',
  '"': '"',
  "'": "'",
  '`': '`',
  '\\': '\\',
}

/**
 * Convert literal escape sequences (the two chars backslash-n/-t/-" etc.) into
 * the characters they denote — for the common failure where a model double-
 * escapes match text in the tool-call JSON so it can't be found in the file.
 * Single-pass so `\\` is consumed as one unit (no sequential-replace order bug).
 * `includeNewlines` is OFF for apply_patch's per-line use (a `\n` inside a single
 * patch line must stay literal, never split the line) and ON (the default) when a
 * caller unescapes a whole multi-line string at once.
 */
export function unescapeLiteral(s: string, includeNewlines = true): string {
  const re = includeNewlines ? /\\([ntrfv0"'`\\])/g : /\\([trfv0"'`\\])/g
  return s.replace(re, (m, c: string) => ESCAPE_MAP[c] ?? m)
}

export type MatchStrategy =
  | 'exact'
  | 'trailing-whitespace'
  | 'indentation'
  | 'trimmed'
  | 'punctuation'
  | 'whitespace'
  | 'block-anchor'
  | 'fuzzy'

export interface PatchMatch {
  index: number
  length: number
  exact: boolean
  strategy: MatchStrategy
}

type StrategyFinder = (
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  limit: number,
) => MatchCandidate[]

/**
 * Strict-first strategy ladder. Line strategies are ordered so each is a strict
 * superset of the previous: byte-exact, then trailing whitespace ignored, then
 * uniformly de-indented blocks, then per-line trim, then Unicode-normalized
 * (NFKC + smart quotes/dashes/spaces), then all internal whitespace collapsed.
 * block-anchor and fuzzy are guarded last resorts (heavily gated above).
 * `whitespace` composes normalizeUnicode so monotonicity holds for it too.
 */
const MATCH_STRATEGIES: ReadonlyArray<{ name: MatchStrategy; find: StrategyFinder }> = [
  { name: 'exact', find: (l, p, s, e, n) => scanLines(l, p, s, e, (v) => v, n) },
  {
    name: 'trailing-whitespace',
    find: (l, p, s, e, n) => scanLines(l, p, s, e, (v) => v.trimEnd(), n),
  },
  { name: 'indentation', find: scanIndentFlexible },
  { name: 'trimmed', find: (l, p, s, e, n) => scanLines(l, p, s, e, (v) => v.trim(), n) },
  {
    name: 'punctuation',
    find: (l, p, s, e, n) => scanLines(l, p, s, e, (v) => normalizeUnicode(v).trim(), n),
  },
  {
    name: 'whitespace',
    find: (l, p, s, e, n) =>
      scanLines(l, p, s, e, (v) => normalizeUnicode(v).replace(/\s+/g, ' ').trim(), n),
  },
  { name: 'block-anchor', find: blockAnchorCandidates },
  { name: 'fuzzy', find: fuzzyCandidates },
]

/** Human-readable tolerance label used in success notes and ambiguity errors. */
export function describeStrategy(strategy: MatchStrategy): string {
  switch (strategy) {
    case 'exact':
      return 'exact'
    case 'trailing-whitespace':
      return 'trailing-whitespace'
    case 'indentation':
      return 'indentation'
    case 'trimmed':
      return 'trimmed-lines'
    case 'punctuation':
      // Say what was actually normalized: the model wrote ASCII where the file has
      // Unicode confusables (or vice versa) — the note must name that, not a vague
      // "punctuation", so the model knows the file's real bytes differ from its own.
      return 'unicode-normalization (smart quotes/dashes/spaces)'
    case 'whitespace':
      return 'whitespace'
    case 'block-anchor':
      return 'block-anchor fuzzy'
    case 'fuzzy':
      return 'fuzzy'
  }
}

/**
 * `block-anchor` is the only strategy that matches a region of a DIFFERENT length than
 * the pattern (it anchors on the first + last lines and scores the middle). That makes
 * it the one strategy that can ACCEPT a malformed hunk — e.g. one whose shared context
 * line the model wrote twice — and apply it, silently writing the duplicate line into
 * the file rather than repairing or reporting it. Every other strategy, `fuzzy`
 * included, is line-for-line. So `skipBlockAnchor` lets the caller run the deterministic
 * hunk repairs before that one last resort gets a say.
 */
const isBlockAnchor = (s: { name: MatchStrategy }) => s.name === 'block-anchor'

/**
 * First match from `start`, walking the ladder strictest-first. Used by
 * apply_patch, whose chunks are applied positionally.
 */
export function findMatch(
  lines: string[],
  pattern: string[],
  start: number,
  eof: boolean,
  skipBlockAnchor = false,
): PatchMatch | null {
  if (pattern.length === 0) return { index: start, length: 0, exact: true, strategy: 'exact' }
  const ladder = skipBlockAnchor
    ? MATCH_STRATEGIES.filter((s) => !isBlockAnchor(s))
    : MATCH_STRATEGIES
  for (const strategy of ladder) {
    const candidates = strategy.find(lines, pattern, start, eof, 1)
    if (candidates.length > 0) {
      const { index, length } = candidates[0]
      return { index, length, exact: strategy.name === 'exact', strategy: strategy.name }
    }
  }
  return null
}

export type UniqueMatchResult =
  | { kind: 'match'; match: PatchMatch }
  | { kind: 'ambiguous'; strategy: MatchStrategy; count: number }
  | { kind: 'none' }

/**
 * Whole-file unique match: require exactly one unambiguous location. Ambiguity
 * is judged AT the tolerance level that produced the match: walk the ladder
 * strictest-first; the first strategy with any candidates decides -- exactly
 * one applies, two or more is an ambiguity error at that strategy. This
 * replaces the old full-tolerance pre-count, which produced false "Found 2
 * occurrences" errors for unambiguous exact matches.
 */
export function findUniqueMatch(lines: string[], pattern: string[]): UniqueMatchResult {
  if (pattern.length === 0) return { kind: 'none' }
  for (const strategy of MATCH_STRATEGIES) {
    const candidates = strategy.find(lines, pattern, 0, false, 2)
    if (candidates.length === 1) {
      const { index, length } = candidates[0]
      return {
        kind: 'match',
        match: { index, length, exact: strategy.name === 'exact', strategy: strategy.name },
      }
    }
    if (candidates.length > 1) {
      return { kind: 'ambiguous', strategy: strategy.name, count: candidates.length }
    }
  }
  return { kind: 'none' }
}
