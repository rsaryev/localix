/**
 * Pure inline-Markdown tokenizer. Splits a single line of Markdown text into styled
 * {@link InlineSpan}s (bold / italic / inline-code) so the docx and pdf generators can
 * render real character formatting instead of literal `**` / `_` / `` ` `` markers.
 *
 * A pragmatic subset — no lib deps, no DOM: `` `code` `` (literal, no nested style),
 * `**bold**`, `__bold__`, `*italic*`, `_italic_`, plus `[text](url)` / `![alt](url)`
 * flattened to readable text. Anything it can't parse falls through as plain text, so
 * it never throws on odd input.
 */

/** A run of text with optional character styling. */
export interface InlineSpan {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

import { flattenLinks } from './flatten-links'

/** Push text onto the last span when styling matches, else start a new span. */
function pushSpan(spans: InlineSpan[], text: string, style: Omit<InlineSpan, 'text'>): void {
  if (!text) return
  const last = spans[spans.length - 1]
  if (
    last &&
    !!last.bold === !!style.bold &&
    !!last.italic === !!style.italic &&
    !!last.code === !!style.code
  ) {
    last.text += text
    return
  }
  spans.push({ text, ...style })
}

/**
 * Parse a line of inline Markdown into styled spans. Never throws; unmatched markers
 * are emitted verbatim. Returns a single plain span for empty input so callers always
 * have something to render.
 */
export function parseInline(raw: string): InlineSpan[] {
  const text = flattenLinks(raw)
  const spans: InlineSpan[] = []
  let bold = false
  let italic = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (ch === '\\' && text[i + 1] && /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/u.test(text[i + 1]!)) {
      pushSpan(spans, text[i + 1]!, { bold: bold || undefined, italic: italic || undefined })
      i += 2
      continue
    }

    // Inline code: literal run to the next backtick (no nested styling inside).
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        pushSpan(spans, text.slice(i + 1, end), { code: true })
        i = end + 1
        continue
      }
    }

    // Bold: **…** or __…__ (two markers). Checked before the single-marker italic.
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      bold = !bold
      i += 2
      continue
    }

    // Italic: *…* or _…_ (one marker).
    if (ch === '*' || ch === '_') {
      italic = !italic
      i += 1
      continue
    }

    pushSpan(spans, ch, { bold: bold || undefined, italic: italic || undefined })
    i += 1
  }

  return spans.length > 0 ? spans : [{ text: '' }]
}

/** Flatten spans back to plain text (drops styling) — used where formatting can't apply. */
export function spansToText(spans: InlineSpan[]): string {
  return spans.map((s) => s.text).join('')
}
