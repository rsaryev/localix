import { truncateHead, truncateTail } from '@localixai/agent'
import { truncationMarker } from '../tool-output'
import { alignToCharBoundary } from './file-utils'

/** Byte cap on the rich `details.output` shown in the UI. */
export const MAX_OUTPUT_BYTES = 64_000

/** Pure size/truncation shape shared by search results. */
export interface SearchOutput {
  bytes: number
  truncated: boolean
  output: string
}

/**
 * The query is a ripgrep REGEX. A no-match is often a false negative because the
 * model searched for a literal string containing regex metacharacters (e.g.
 * `array.map(` or `config.value`) — `.`, `(`, etc. don't match themselves. Detect
 * UNescaped metacharacters so the no-match message can nudge toward escaping.
 */
export function hasUnescapedRegexMeta(query: string): boolean {
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (ch === '\\') {
      i++
      continue
    } // skip the escaped char
    if ('([{.*+?^$|)]}'.includes(ch)) return true
  }
  return false
}

export function truncateOutput(output: string): SearchOutput {
  // Measure before copying: most searches fit, and those never need a byte buffer.
  const bytes = Buffer.byteLength(output)
  if (bytes <= MAX_OUTPUT_BYTES) return { bytes, truncated: false, output }
  const buffer = Buffer.from(output)

  return {
    bytes,
    truncated: true,
    // Back up to a char boundary so the cut never splits a multi-byte char.
    output: `${buffer.subarray(0, alignToCharBoundary(buffer, MAX_OUTPUT_BYTES)).toString('utf8')}\n[…truncated…]`,
  }
}

/** Don't bother grouping tiny result sets — no meaningful savings. */
const MIN_GROUP_LINES = 10

/**
 * Group ripgrep `path:line:text` output by FILE, so the path is printed once
 * per file instead of on every match line (repeated paths are routinely
 * 40-60% of a search result's bytes). Identical match text within a file is
 * collapsed to one entry listing its line numbers. Conservative by design:
 * any line that doesn't parse as `path:line:text` aborts grouping (returns
 * null → caller keeps the raw output), and the caller applies never-worse.
 */
/**
 * Parse `path:line:text` output into file → (text → line numbers), insertion-ordered.
 *
 * Conservative by construction: ONE unparseable line aborts the whole parse and returns null.
 * That is what makes it safe to build on — a caller can never act on a half-understood result, and
 * a change in ripgrep's output shape degrades to "we learned nothing" rather than to wrong data.
 *
 * Shared so there is one regex for this format. It had one reader (the grouper below); publishing
 * search provenance made a second, and a second copy of a format guess is how the two drift.
 */
export function parseMatchLines(output: string): Map<string, Map<string, number[]>> | null {
  const lines = output.split('\n').filter((l) => l !== '')
  if (lines.length === 0) return null
  const files = new Map<string, Map<string, number[]>>()
  for (const line of lines) {
    const m = line.match(/^(.+?):(\d+):(.*)$/)
    if (!m) return null
    const [, file, lineNo, text] = m
    let byText = files.get(file)
    if (!byText) files.set(file, (byText = new Map()))
    const nums = byText.get(text)
    if (nums) nums.push(Number(lineNo))
    else byText.set(text, [Number(lineNo)])
  }
  return files
}

/**
 * Every file a content search matched, with the line of its FIRST hit.
 *
 * One entry per file, not per match: a search that hits a file forty times found one place worth
 * looking at, and forty rows that open the same tab is a list nobody reads.
 */
export function matchedFiles(output: string): { file: string; line: number }[] {
  const files = parseMatchLines(output)
  if (!files) return []
  const out: { file: string; line: number }[] = []
  for (const [file, byText] of files) {
    const first = [...byText.values()].flat().sort((a, b) => a - b)[0]
    if (first !== undefined) out.push({ file, line: first })
  }
  return out
}

export function groupMatches(output: string): string | null {
  const lines = output.split('\n').filter((l) => l !== '')
  if (lines.length < MIN_GROUP_LINES) return null

  const files = parseMatchLines(output)
  if (!files) return null

  const out: string[] = []
  for (const [file, byText] of files) {
    out.push(`${file}:`)
    for (const [text, nums] of byText) {
      const shown = nums.slice(0, 3).join(',')
      const more = nums.length > 3 ? `(+${nums.length - 3} more)` : ''
      out.push(`  ${shown}${more}: ${text}`)
    }
  }
  out.push(
    `[${lines.length} matches in ${files.size} files — grouped by file; "12,40(+2 more)" = same text on more lines]`,
  )
  return out.join('\n')
}

/**
 * Trim the MODEL-facing ripgrep output by line + byte limits. Content search keeps
 * the LAST N so trailing files and summaries survive; file listing keeps the FIRST N
 * because stable discovery order and the producer sentinel are its navigation contract.
 * The richer `details.output` (UI) keeps the existing byte cap; this only shrinks
 * what is re-sent into the prompt. No-op below the default limits.
 *
 * `unit` tailors the wording: 'match' for a content search, 'file' for a `rg --files`
 * listing (whose lines are file PATHS, not matches — calling them "match lines"
 * and advising "narrow the query" would mislead, since the listing has no query).
 *
 * One tool result must never consume a material fraction of an agent's active-turn
 * budget. The UI/durable details retain the larger `truncateOutput` projection; only
 * the prompt projection is capped here. 16 KiB is a hard ingress bound in front of later
 * context pruning, instead of asking pruning to rescue several 50 KiB search results after
 * they have accumulated.
 */
export const MODEL_SEARCH_MAX_BYTES = 16 * 1024
export const MODEL_SEARCH_MAX_LINES = 500
const MODEL_SEARCH_MARKER_RESERVE_BYTES = 512

export function modelFacingMatches(output: string, unit: 'match' | 'file' = 'match'): string {
  // Content searches get the by-file grouping first (never-worse guarded);
  // file listings are already one path per line — nothing to group.
  if (unit === 'match') {
    const grouped = groupMatches(output)
    if (grouped !== null && grouped.length < output.length) output = grouped
  }
  const truncate = unit === 'file' ? truncateHead : truncateTail
  const r = truncate(output, {
    // The marker is part of the model-facing result too. Reserve its space so
    // the advertised ingress bound covers the complete returned string.
    maxBytes: MODEL_SEARCH_MAX_BYTES - MODEL_SEARCH_MARKER_RESERVE_BYTES,
    maxLines: MODEL_SEARCH_MAX_LINES - 1,
  })
  if (!r.truncated) return output
  const marker = truncationMarker(r, {
    kept: unit === 'file' ? 'first' : 'last',
    noun: unit === 'file' ? 'file path' : 'match line',
    advice:
      unit === 'file'
        ? 'To see all files, use a more specific glob (e.g. glob:"src/**/*.ts").'
        : 'To see all matches, do not run another broad search. Narrow the next search with a more specific query, cwd, or glob (e.g. glob:"src/**/*.ts").',
  })
  return `${marker}\n${r.content}`
}

/**
 * Escape every ripgrep-regex metacharacter, turning a query into a literal-string
 * search. 72 of the 98 empty searches in the recorded corpus carried an UNescaped
 * metacharacter (`array.map(`, `config.value`), so the "no matches" was a false
 * negative on a query the model meant literally.
 */
export function escapeRegex(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One widened retry of a search that found nothing. */
export interface SearchRetry {
  /** Model-facing description of what was changed, e.g. "without the glob". */
  label: string
  query: string
  glob?: string
}

/**
 * The retries worth attempting when a search returns nothing, strictest first. A
 * globbed search is the dominant false negative (86 of the 98 empty searches in the
 * corpus carried a glob); an unescaped regex metacharacter is the next. Pure: the
 * caller runs them. Empty when the query is already literal and unscoped — there is
 * nothing obvious left to try, and "no matches" is the honest answer.
 */
export function searchRetries(query: string, glob?: string): SearchRetry[] {
  const retries: SearchRetry[] = []
  if (glob) retries.push({ label: 'without the glob', query })
  if (hasUnescapedRegexMeta(query)) {
    const literal = escapeRegex(query)
    if (glob) retries.push({ label: 'as a literal string, keeping the glob', query: literal, glob })
    retries.push({
      label: glob ? 'as a literal string, without the glob' : 'as a literal string',
      query: literal,
    })
  }
  return retries
}
