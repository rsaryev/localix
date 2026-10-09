// Matching policy: scan candidates in strictest-first order, then enforce uniqueness.
import { normalizeUnicode } from './patch-text'
import {
  scanLines,
  scanIndentFlexible,
  blockAnchorCandidates,
  fuzzyCandidates,
} from './patch-match-scans'
import type {
  MatchStrategy,
  PatchMatch,
  StrategyFinder,
  UniqueMatchResult,
} from './patch-match-contracts'

export type { MatchStrategy, PatchMatch, UniqueMatchResult } from './patch-match-contracts'
export { reindentNewLines, unescapeLiteral } from './patch-text'
export { buildNotFoundHint, buildRepairDiagnosis, closestLineHint } from './patch-hints'

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
