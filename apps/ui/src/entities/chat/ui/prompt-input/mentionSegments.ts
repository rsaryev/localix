// Pure tokenizer behind the composer's mention HIGHLIGHT mirror. Splits draft
// text into ordered segments — plain-text runs and the `@`-tokens that classify
// as real mentions — so the view (renderMentionHighlight) only has to map each
// segment to a node. Kept JSX-free so the boundary rules stay unit-testable.
import { atTokenLength } from '@/shared/lib/fileMention'

export type MentionSegment = { type: 'text'; value: string } | { type: 'mention'; value: string }

/** Any `@`-token at a word boundary; classification decides if it's pilled. */
const AT_TOKEN_RE = /(^|\s)@(\S+)/g

/**
 * Split `text` into ordered segments: runs of plain text and the `@`-tokens that classify as a
 * context reference — a link-only `@path` or a context-ref (`@file:`/`@folder:`/`@diff`/`@git:`),
 * per `atTokenLength`.
 *
 * A trailing '\n' text segment is ALWAYS appended so the highlight mirror's
 * last-line height stays in sync with the textarea, which reserves a line after
 * a final newline.
 */
export function splitMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(AT_TOKEN_RE)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0)
    const len = atTokenLength(match[2] ?? '')
    if (len === null || start < cursor) continue
    if (start > cursor) segments.push({ type: 'text', value: text.slice(cursor, start) })
    segments.push({ type: 'mention', value: text.slice(start, start + 1 + len) })
    cursor = start + 1 + len
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  segments.push({ type: 'text', value: '\n' })
  return segments
}
