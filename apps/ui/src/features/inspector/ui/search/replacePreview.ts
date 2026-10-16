/**
 * computeReplacement — the text a single search match becomes once the Replace
 * field is applied, used to render the inline preview diff (struck-through
 * original + green replacement) in the Search results.
 *
 * Mirrors the backend substitution semantics (apps/api search-replace.ts) so the
 * preview matches what "Replace all" actually writes: literal vs regex, smart-
 * case, whole-word; in regex mode `$1`/`$<name>` capture references expand, in
 * literal mode a `$` stays literal. Pure — no fs/DOM — so it is unit-testable.
 */
export interface ReplacePreviewOptions {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the matcher RegExp, mirroring buildReplaceRegExp on the server. */
function buildRegExp(query: string, opts: ReplacePreviewOptions): RegExp | null {
  if (!query) return null
  let pattern = opts.regex ? query : escapeRegExp(query)
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`
  const hasUpper = /[A-Z]/.test(query)
  const flags = opts.caseSensitive || hasUpper ? '' : 'i'
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/**
 * The replacement text for `matched` (the exact substring the search highlighted).
 * Returns null when the query is empty/invalid — caller then shows no preview.
 */
export function computeReplacement(
  matched: string,
  query: string,
  replacement: string,
  opts: ReplacePreviewOptions = {},
): string | null {
  const re = buildRegExp(query, opts)
  if (!re) return null
  const safe = opts.regex ? replacement : replacement.replace(/\$/g, '$$$$')
  return matched.replace(re, safe)
}
