// Pure search-and-replace helpers — the text transform behind the Search view's
// "Replace all". Kept free of fs/env so the substitution semantics are unit-
// testable in isolation. Mirrors the searchContent matching options (literal vs
// regex, smart-case, whole-word) so what you replace matches what you searched.

export interface ReplaceMatcherOptions {
  /** Treat the query as a regular expression (default false = literal). */
  regex?: boolean
  /** Force case-sensitive (default false = smart-case). */
  caseSensitive?: boolean
  /** Match whole words only. */
  wholeWord?: boolean
}

/** Escape regex metacharacters so a literal query matches verbatim. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build the global RegExp used to find (and replace) matches, mirroring the
 * ripgrep flags searchContent uses. Smart-case: case-insensitive unless the
 * query has an uppercase letter (or caseSensitive is set). Returns null when a
 * regex query is malformed.
 */
export function buildReplaceRegExp(query: string, opts: ReplaceMatcherOptions = {}): RegExp | null {
  if (!query) return null
  let pattern = opts.regex ? query : escapeRegExp(query)
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`
  const hasUpper = /[A-Z]/.test(query)
  const flags = `g${opts.caseSensitive || hasUpper ? '' : 'i'}`
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/**
 * Apply `replacement` to every match of `re` in `text`. When `literalReplacement`
 * is true (non-regex search) a `$` in the replacement is kept literal; in regex
 * mode `$1`/`$<name>` capture references pass through to String.replace. Returns
 * the new text and the number of replacements made.
 */
export function applyReplace(
  text: string,
  re: RegExp,
  replacement: string,
  literalReplacement: boolean,
): { text: string; count: number } {
  // A global regex: `match()` returns every matched string; `replace()` resets
  // lastIndex too, so counting then replacing is safe.
  const count = (text.match(re) ?? []).length
  if (count === 0) return { text, count: 0 }
  // Literal mode: keep `$` in the replacement literal. Regex mode: let
  // String.replace expand `$1`/`$<name>` capture references.
  const safe = literalReplacement ? replacement.replace(/\$/g, '$$$$') : replacement
  return { text: text.replace(re, safe), count }
}
