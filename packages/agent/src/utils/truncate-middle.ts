/**
 * Truncate from the MIDDLE: keep a head and a tail, name the gap between them.
 *
 * The third truncation direction, and the one `truncate.ts` cannot express. Those two keep
 * ONE end under LINE and BYTE limits and leave the marker to the caller. This keeps BOTH
 * ends under a CHARACTER budget and counts the marker inside it, which is what a summarizer
 * prompt needs: the head says what a body was, the tail says how it ended, and the total is
 * exactly what was promised. Separate file because it shares none of that arithmetic — no
 * UTF-8 byte walk, no line counting.
 *
 * Counting the marker inside the budget is the correctness point. Keeping `max` characters
 * and THEN appending a marker makes every "bounded" body exceed its cap, and at a zero-sized
 * boundary `slice(-0)` reproduces the whole input — the bug this shape exists to prevent.
 */

/** How much of a middle-truncated body the head may take when no explicit cap is given. */
const DEFAULT_HEAD_FRACTION = 0.65

export interface MiddleTruncationOptions {
  /** Total characters the result may occupy, MARKER INCLUDED. */
  maxChars: number
  /** Cap on the head half; the tail takes the rest. Default: 65% of what fits. */
  maxHeadChars?: number
  /**
   * The line that names the gap, given how many characters it replaces. A caller whose marker
   * is a CONTRACT (a compression layer's elision marker, which later passes test for) supplies
   * it here rather than re-implementing the head/tail arithmetic around a string of its own.
   */
  marker?: (omittedChars: number) => string
}

const defaultMarker = (omittedChars: number) => `\n[… ${omittedChars} chars omitted …]\n`

export function truncateMiddle(content: string, options: MiddleTruncationOptions): string {
  const { maxChars } = options
  if (maxChars <= 0) return ''
  if (content.length <= maxChars) return content
  const markerFor = options.marker ?? defaultMarker

  // Two passes: the marker states how much was dropped, and stating it changes how much
  // fits, so the count is recomputed once against the budget it actually leaves.
  let marker = markerFor(content.length - maxChars)
  let keptChars = Math.max(0, maxChars - marker.length)
  marker = markerFor(content.length - keptChars)
  keptChars = Math.max(0, maxChars - marker.length)
  if (keptChars === 0) return marker.slice(0, maxChars)

  const headBudget = options.maxHeadChars ?? Math.floor(keptChars * DEFAULT_HEAD_FRACTION)
  const head = Math.min(headBudget, Math.floor(keptChars * DEFAULT_HEAD_FRACTION))
  const tail = keptChars - head
  return `${content.slice(0, head)}${marker}${tail > 0 ? content.slice(-tail) : ''}`
}
