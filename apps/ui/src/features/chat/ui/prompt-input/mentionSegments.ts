// Pure tokenizer behind the composer's mention HIGHLIGHT mirror. Splits draft
// text into ordered segments — plain-text runs and the `@`-tokens that classify
// as real mentions — so the view (renderMentionHighlight) only has to map each
// segment to a node. Kept JSX-free so the boundary rules stay unit-testable.
import { mentionSpans } from '@localixai/api/agent-mentions'

import { atTokenLength } from '@/shared/lib/fileMention'

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string }
  /**
   * A participant of THIS conversation, named by handle. Its own kind rather than a `mention`
   * because it is drawn in that participant's own colour, and the colour needs the handle — a
   * `@file:` chip has no identity behind it to take a hue from.
   */
  | { type: 'agent'; value: string; handle: string }

/** Any `@`-token at a word boundary; classification decides if it's pilled. */
const AT_TOKEN_RE = /(^|\s)@(\S+)/g

interface Token {
  start: number
  end: number
  handle?: string
}

/**
 * Split `text` into ordered segments: runs of plain text, the participant mentions, and the
 * `@`-tokens that classify as a context reference — a link-only `@path` or a context-ref
 * (`@file:`/`@folder:`/`@diff`/`@git:`), per `atTokenLength`.
 *
 * PARTICIPANTS ARE READ BY THE CONVERSATION'S OWN GRAMMAR (`agent-mentions`), because the
 * composer drawing a chip is a promise that the conversation will route to it. This used to be a
 * second grammar — whitespace-only boundary, case-sensitive, no `.` in a handle — so the pill and
 * the routing disagreed on "@QA", on "(@qa", and on `@a.b`. A token that is both a participant and
 * a plausible path is a participant: in a conversation, that is what the person means.
 *
 * A trailing '\n' text segment is ALWAYS appended so the highlight mirror's
 * last-line height stays in sync with the textarea, which reserves a line after
 * a final newline.
 */
export function splitMentionSegments(
  text: string,
  /** The handles this conversation knows — its participants, plus `all`. */
  agentHandles: readonly string[] = [],
): MentionSegment[] {
  const tokens: Token[] = mentionSpans(text, agentHandles).map(({ start, end, handle }) => ({
    start,
    end,
    handle,
  }))
  const covered = (index: number) => tokens.some((t) => index >= t.start && index < t.end)
  for (const match of text.matchAll(AT_TOKEN_RE)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0)
    if (covered(start)) continue
    const len = atTokenLength(match[2] ?? '')
    if (len !== null) tokens.push({ start, end: start + 1 + len })
  }
  tokens.sort((a, b) => a.start - b.start)

  const segments: MentionSegment[] = []
  let cursor = 0
  for (const token of tokens) {
    if (token.start < cursor) continue
    if (token.start > cursor)
      segments.push({ type: 'text', value: text.slice(cursor, token.start) })
    const value = text.slice(token.start, token.end)
    segments.push(
      token.handle ? { type: 'agent', value, handle: token.handle } : { type: 'mention', value },
    )
    cursor = token.end
  }
  if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) })
  segments.push({ type: 'text', value: '\n' })
  return segments
}
