/**
 * A TEXT PART THAT SAYS THE SAME THING TWICE IS ONE PART.
 *
 * The defect: a member's reply arrived as its own paragraphs followed by the same
 * paragraphs again, byte for byte. The accumulator did not do it — `message_end` SETS each text
 * part from the provider's final message rather than appending to the streamed deltas — so the
 * doubling was already in the stream, from the provider or the model. One row in thirty-seven,
 * and not reproducible on demand, which is exactly why it is caught here rather than upstream:
 * the row is what the person reads, and a paragraph repeated verbatim is never what a model
 * meant to say. Collapsing it loses nothing.
 *
 * Deliberately narrow so it can never touch a real answer: the whole text must split into two
 * halves that are identical after trimming, and each half must be long enough (a paragraph, not
 * a word) that a short reply repeated on two lines — "yes\n\nyes" — stays as written.
 */

/** Below this many characters per half, a repeat is a short answer said twice on purpose. */
const MIN_HALF_CHARS = 40

/** The text with a verbatim second copy of itself removed, or the text unchanged. */
export function collapseDoubledText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length < MIN_HALF_CHARS * 2) return text
  const paragraphs = trimmed.split(/\n\s*\n/u)
  if (paragraphs.length % 2 !== 0) return text
  const half = paragraphs.length / 2
  const first = paragraphs.slice(0, half).map((p) => p.trim())
  const second = paragraphs.slice(half).map((p) => p.trim())
  if (first.some((p, i) => p !== second[i])) return text
  const kept = first.join('\n\n')
  return kept.length >= MIN_HALF_CHARS ? kept : text
}
