// Pure, DOM-free sentence math for the prose comment selection: split text into
// sentence [start,end) char ranges, and expand an arbitrary [selStart,selEnd)
// selection to cover every sentence it touches. The DOM walking (offsets ↔ nodes,
// range re-apply) lives in text-selection.ts; this is the locale-aware string
// logic, unit-testable on its own. Uses Intl.Segmenter when present, else a
// `.!?…` terminator scan.

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
    : null

/** [start,end) range of every sentence in `text`, via a `.!?…` terminator scan.
 *  The deterministic fallback used where Intl.Segmenter is unavailable. */
export function sentenceBoundsRegex(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = 0
  const re = /[.!?…]+[\s)"'»]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push([start, m.index + m[0].length])
    start = m.index + m[0].length
  }
  if (start < text.length) out.push([start, text.length])
  return out
}

/** [start,end) range of every sentence in `text` (Intl.Segmenter when available,
 *  else {@link sentenceBoundsRegex}). */
export function sentenceBounds(text: string): Array<[number, number]> {
  if (!segmenter) return sentenceBoundsRegex(text)
  const out: Array<[number, number]> = []
  for (const seg of segmenter.segment(text)) out.push([seg.index, seg.index + seg.segment.length])
  return out
}

/** Expand a [selStart,selEnd) selection to cover every sentence it touches (per
 *  `bounds`), then trim surrounding whitespace. Returns the [start,end) window; it
 *  is empty (start === end) when the touched span is all whitespace. */
export function expandToSentences(
  text: string,
  bounds: Array<[number, number]>,
  selStart: number,
  selEnd: number,
): [number, number] {
  let start = selStart
  let end = selEnd
  for (const [s, e] of bounds) {
    if (s < selEnd && e > selStart) {
      start = Math.min(start, s)
      end = Math.max(end, e)
    }
  }
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return [start, end]
}
