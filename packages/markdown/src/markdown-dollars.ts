import { isEscaped, markdownProseWithoutCode } from './markdown-prose'

/**
 * Which `$` in a reply is a dollar sign rather than a math delimiter — one rule for the renderer
 * and for the streaming stabilizer.
 *
 * remark-math pairs ANY two single dollars in a paragraph, so the moment a reply held one real
 * formula, "costs $5 and $10" was typeset as the formula `5 and`, and "$HOME/bin and $PATH" became
 * italic math that also swallowed the backticks after it. The sniffer that decides whether to load
 * KaTeX already knew better; the parser did not. So the literal dollars are escaped (`\$`) before
 * the parser sees them, which CommonMark renders as a plain `$` — and the rule is kept here, once,
 * because the stabilizer must make the same call about the dollar a streaming tail ends on.
 */

/** A currency amount: digits, an optional magnitude, then a non-math character or the end. */
const CURRENCY = /^\d[\d.,]*(?:[kKmMbB])?(?=[\s.,;:!?)\]'"`–—-]|$)/
/** A shell or environment variable: an upper-case name, ended by a path or list separator. */
const VARIABLE = /^[A-Z_][A-Z0-9_]+(?=[/:.,;)\]'"`]|$)/
/** A longer upper-case name also ends at a space (`$PATH before`); `$AB = CD$` stays math. */
const LONG_VARIABLE = /^[A-Z_][A-Z0-9_]{2,}(?=\s)/

export function isLiteralDollar(text: string, index: number): boolean {
  if (text[index] !== '$' || isEscaped(text, index)) return false
  // `$$` is display math, never a dollar sign.
  if (text[index - 1] === '$' || text[index + 1] === '$') return false
  const after = text.slice(index + 1, index + 48)
  return CURRENCY.test(after) || VARIABLE.test(after) || LONG_VARIABLE.test(after)
}

/** The source with every literal dollar in prose escaped; code is left byte for byte. */
export function escapeLiteralDollars(markdown: string): string {
  if (!markdown.includes('$')) return markdown
  const prose = markdownProseWithoutCode(markdown)
  let escaped = ''
  let copied = 0
  let changed = false
  for (let index = prose.indexOf('$'); index !== -1; index = prose.indexOf('$', index + 1)) {
    if (!isLiteralDollar(prose, index)) continue
    escaped += `${markdown.slice(copied, index)}\\`
    copied = index
    changed = true
  }
  return changed ? escaped + markdown.slice(copied) : markdown
}
