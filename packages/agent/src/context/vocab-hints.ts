/**
 * VOCABULARY HINTS — the few words a pointer carries FROM the content it replaced.
 *
 * An elision pointer tells the model that content exists and how to get it back. What it
 * cannot tell the model is what is IN there — so a follow-up (`ToolOutput`, a re-read,
 * a search) is aimed by guessing vocabulary. Guessed vocabulary misses: the model searches
 * for `handleError` in output that says `onFailure`, gets nothing, and concludes the content
 * is irrelevant rather than that its query was.
 *
 * So a pointer over LARGE content also names a handful of DISTINCTIVE terms that provably
 * occur in it. Distinctive is doing the work: a term is only worth its tokens if it
 * SELECTS — identifiers, dotted paths, file names, error codes, capitalised proper terms.
 * Prose words ("the", "function", "returns") occur everywhere and select nothing, so they
 * are never emitted, and neither is anything from a body small enough that the hints would
 * cost a meaningful fraction of what eliding it saved ({@link HINT_MIN_SOURCE_CHARS}).
 *
 * Pure, allocation-bounded, and honest by construction: every emitted term is a substring
 * of the source text.
 */

import { STOPWORDS, FILE_EXTS } from './vocab-hint-lexicon'

/**
 * Below this many source chars, no hints. Eliding ~500 tokens to save ~490 and then
 * spending ~50 back on hints is not a trade worth making; above it the hints are noise-
 * level next to the savings.
 */
export const HINT_MIN_SOURCE_CHARS = 2000
/** At most this many terms — the pointer must stay a pointer. */
export const MAX_HINTS = 12
/** …and at most this many chars of them, whichever binds first (~40-50 tokens). */
export const MAX_HINT_CHARS = 180

const MIN_TERM_LEN = 3
const MAX_TERM_LEN = 40
/** Scanning the whole of a multi-MB dump to pick 12 words is not worth the CPU. */
const MAX_SCAN_CHARS = 200_000

/**
 * Candidate terms: an identifier-ish head, optionally continued through `.`/`/`/`-` so
 * `foo.bar.baz`, `src/index.ts` and `well-known` survive as ONE term (splitting them
 * yields the useless halves), plus bare digit-bearing codes (`TS2345`, `E404`).
 */
const TOKEN_RE = /[A-Za-z_$][A-Za-z0-9_$]*(?:[./-][A-Za-z0-9_$]+)*|[A-Z]+[0-9]+/g

/**
 * A long path is the most selective term in a dump AND the most expensive to name — 50
 * chars of `apps/api/src/features/chat/runtime/agent-runner.ts` is a third of the whole hint
 * budget for one term. Its TAIL is what selects (`runtime/agent-runner.ts`); the leading
 * directories are shared with every other path in the same dump. So an over-long path term
 * is shortened to its last two segments, which is still a substring of the source — the
 * honesty property every emitted term has to keep.
 */
function normalizeTerm(term: string): string {
  if (term.length <= MAX_TERM_LEN || !term.includes('/')) return term
  const parts = term.split('/')
  const tail = parts.slice(-2).join('/')
  return tail.length <= MAX_TERM_LEN ? tail : parts[parts.length - 1]
}

/** Does this look like a NAME someone chose, rather than an English word? */
const isNameLike = (s: string): boolean =>
  s.length >= MIN_TERM_LEN &&
  (/[-_]/.test(s) || /[a-z][A-Z]/.test(s) || /^[A-Z]/.test(s) || /\d/.test(s))

/**
 * How strongly a term SELECTS, or 0 for "don't emit it". Tiers, not a score: a path is a
 * better query than a camelCase identifier, which is a better query than a capitalised
 * word, and no amount of frequency should let a weaker kind outrank a stronger one.
 */
function tierOf(term: string): number {
  if (term.length < MIN_TERM_LEN || term.length > MAX_TERM_LEN) return 0
  if (STOPWORDS.has(term.toLowerCase())) return 0
  // A path or a file name: names the WHERE, and no two dumps share one by accident.
  // The extension is checked against a KNOWN list rather than a `\.[a-z]{2,4}$` shape,
  // because that shape is also every short member access — `tc.id`, `m.role`, `out.push`
  // — which then outrank every real identifier in the dump.
  // (`term.includes('.')` first: without it a bare `bash`/`log`/`env` IS its own
  // extension and every mention of the word ranks as a file name.)
  if (term.includes('.') && FILE_EXTS.has(term.slice(term.lastIndexOf('.') + 1).toLowerCase()))
    return 4
  // A slash alone does not make a path: prose writes `read/write`, `I/O`,
  // `bash/command/test/build`, and those are stopword salad with a slash in it. A real
  // path has at least one segment that is a NAME (hyphenated, cased, digit-bearing).
  if (term.includes('/')) return term.split('/').some(isNameLike) ? 4 : 1
  // An identifier the language shaped, with no dot: camelCase, snake_case,
  // SCREAMING_CASE, $foo — the names a follow-up search is actually run on.
  if (!term.includes('.') && (/[a-z][A-Z]/.test(term) || /[_$]/.test(term))) return 3
  // Letters AND digits: error/status codes (EACCES2, TS2345).
  if (!term.includes('.') && /[A-Za-z]/.test(term) && /[0-9]/.test(term)) return 3
  // ALL-CAPS token (ENOENT, EACCES) or a Capitalised proper term (ChartCanvas, Kysely).
  if (!term.includes('.') && /^[A-Z]/.test(term)) return 2
  // A dotted member chain (`deps.db`, `r.toolCallId`). Real vocabulary, but it is mostly
  // the RECEIVER's local name — it dates faster and selects less than the identifier it
  // ends in, so it fills the budget only once the better kinds have had their turn.
  if (/\./.test(term) && /[A-Za-z]/.test(term)) return 1
  // Plain lowercase prose that is not a stopword: it MIGHT be a real identifier, but we
  // cannot tell it from an uncommon English word, and a wrong hint is worse than none.
  return 0
}

/**
 * The distinctive terms of `text`, best-first — at most {@link MAX_HINTS}, each provably
 * present in the source. Empty for anything below {@link HINT_MIN_SOURCE_CHARS}, or when
 * nothing in the text selects (prose, a wall of one repeated byte).
 *
 * Ranking: tier first (see {@link tierOf}), then frequency — a term the content repeats is
 * one the content is ABOUT, and a query for it is the least likely to come back empty —
 * then length, as the tie-break that prefers the more specific of two equals.
 */
export function vocabularyHints(text: string, max = MAX_HINTS): string[] {
  if (text.length < HINT_MIN_SOURCE_CHARS || max <= 0) return []
  const scanned = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text
  // Case-insensitive dedupe, keeping the first spelling accepted by tierOf. Rejected
  // prose does not claim a key; every emitted spelling occurs in the source.
  const seen = new Map<string, { term: string; tier: number; count: number }>()
  for (const m of scanned.matchAll(TOKEN_RE)) {
    const term = normalizeTerm(m[0])
    const key = term.toLowerCase()
    const hit = seen.get(key)
    if (hit) {
      hit.count += 1
      continue
    }
    const tier = tierOf(term)
    if (tier > 0) seen.set(key, { term, tier, count: 1 })
  }
  const ranked = [...seen.values()].sort(
    (a, b) => b.tier - a.tier || b.count - a.count || b.term.length - a.term.length,
  )
  const out: string[] = []
  let chars = 0
  for (const r of ranked) {
    if (out.length >= max) break
    if (chars + r.term.length + 2 > MAX_HINT_CHARS) continue
    chars += r.term.length + 2
    out.push(r.term)
  }
  return out
}

/**
 * The hint clause appended to a pointer, or `''` when there is nothing worth saying.
 *
 * The wording is load-bearing in two directions: it must tell the model these terms are a
 * ROUTE INTO the recovered content (so a follow-up query uses vocabulary that exists), and
 * it must not overclaim — this is a sample of terms, not a summary, and the pointer already
 * says how the full bytes come back.
 */
export function hintClause(text: string, max = MAX_HINTS): string {
  const hints = vocabularyHints(text, max)
  return hints.length ? `; terms found in it: ${hints.join(', ')}` : ''
}
