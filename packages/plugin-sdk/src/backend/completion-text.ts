/**
 * The one cleaner every text-input surface runs its model reply through. It turns whatever the
 * model said into the exact text to insert after the caret, and it is strict about the boundary:
 * trimming a suffix or inventing a space splits typed words, and an echoed fragment doubles them.
 */

/** How far back an echo is searched for. The draft tail sent to the model is bounded anyway. */
const MAX_ECHO_CHARS = 400

/**
 * Remove the part of the reply that repeats the end of the draft.
 *
 * Models asked for "only the suffix" still echo, in three shapes: the whole draft, the last few
 * words, or the unfinished word ("fix the te" → "test suite"). Only the first was handled, and
 * only for the WHOLE draft — which the model cannot even see once the chat tail is clipped to
 * 400 bytes — so the other two painted "fix the tetest suite". Continue strips the same shapes
 * after the fact (`core/autocomplete/postprocessing/index.ts`, the line-start / last-word echo).
 *
 * One rule covers all three: the longest end of the draft that the reply starts with, provided
 * that end begins on a word boundary. The boundary is what keeps a genuine continuation intact —
 * "com" + "pletion" overlaps nothing, and "run" + "Run tests" differs in case, so neither moves.
 */
function stripEchoedTail(value: string, draft: string): string {
  if (!draft || !value) return value
  if (value.startsWith(draft)) return value.slice(draft.length)
  for (let size = Math.min(draft.length, value.length, MAX_ECHO_CHARS); size > 0; size--) {
    const overlap = draft.slice(-size)
    if (!/\S/.test(overlap) || !value.startsWith(overlap)) continue
    const before = draft.slice(0, -size).at(-1)
    if (!before || isWordBoundary(before) || isWordBoundary(overlap[0]!)) return value.slice(size)
  }
  return value
}

/** Anything that is not part of a word: whitespace, punctuation, brackets, operators. */
function isWordBoundary(char: string): boolean {
  return /[^\p{L}\p{N}_]/u.test(char)
}

/** Preserve insertion boundaries: trimming a suffix or inventing a space splits typed words. */
export function cleanCompletionSuffix(raw: string, draft = '', maxChars = 180): string {
  // A reasoning model on an API that inlines its thinking leaks `<think>` blocks into the text.
  let value = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '')
  value = value.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
  value = value.replace(/^(user|assistant|suggestion|completion|next)\s*[:-]\s*/i, '')
  if (/^(?:none|n\/a|no (?:suggestion|completion)|null|undefined|\.\.\.)[.!]?$/i.test(value.trim()))
    return ''
  // Matching is exact: changing case or whitespace would silently change where the suffix joins
  // the user's original draft.
  value = stripEchoedTail(value, draft)
  // The draft already ends in a space, so a leading one would double it ("fix the  tests").
  if (/[ \t]$/.test(draft)) value = value.replace(/^[ \t]+/, '')
  if (!value.trim()) return ''
  return Array.from(value).slice(0, maxChars).join('')
}

/** Keep the exact caret tail, including whitespace, under a UTF-8 byte budget. */
export function completionDraftTail(draft: string, maxBytes: number): string {
  const points = Array.from(draft)
  let bytes = 0
  let start = points.length
  while (start > 0) {
    const size = Buffer.byteLength(points[start - 1]!, 'utf8')
    if (bytes + size > maxBytes) break
    bytes += size
    start--
  }
  return points.slice(start).join('')
}
