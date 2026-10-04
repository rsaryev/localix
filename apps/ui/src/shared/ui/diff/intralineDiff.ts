import { diffWordsWithSpace } from 'diff'
import type { DiffHunk, DiffLine } from './parseUnifiedDiff'

/** One run of a changed line's text, flagged as intra-line changed or unchanged. */
export interface IntralineSegment {
  text: string
  changed: boolean
}

/** True once a segment list carries a common (unchanged) run with real content. */
function hasSharedContent(segments: IntralineSegment[]): boolean {
  return segments.some((s) => !s.changed && s.text.trim() !== '')
}

/**
 * Word-level intra-line diff between a deleted line and its paired added line.
 * Returns null when the pair shares no meaningful text (a whole-line rewrite) —
 * the row-level +/- tint already tells that story, so per-word marks would be noise.
 */
export function segmentLinePair(
  oldText: string,
  newText: string,
): { del: IntralineSegment[]; add: IntralineSegment[] } | null {
  const del: IntralineSegment[] = []
  const add: IntralineSegment[] = []
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (part.added) add.push({ text: part.value, changed: true })
    else if (part.removed) del.push({ text: part.value, changed: true })
    else {
      del.push({ text: part.value, changed: false })
      add.push({ text: part.value, changed: false })
    }
  }
  if (!hasSharedContent(del) || !hasSharedContent(add)) return null
  return { del, add }
}

/** Minimal per-line shape the pairing needs — flag whether a line is a deletion / addition and its raw text. */
export interface PairableLine {
  del: boolean
  add: boolean
  text: string
}

/**
 * Core word-level pairing over a FLAT line list: returns a parallel array (same
 * length/order as `lines`) of intra-line segment lists, or null where a line gets
 * no word-level highlight. Pairs each run of consecutive deletions with the
 * immediately-following run of additions, index by index (the common
 * modify-in-place shape), and computes a word diff for each pair. Any non-del/add
 * line (context, hunk header, meta) breaks a run, so pairs never span a boundary.
 * Shared by the read-only DiffView (per hunk) and the interactive DiffStagingView
 * (over its whole line list) so both surfaces mark the same runs.
 */
export function pairIntralineSegments(lines: PairableLine[]): (IntralineSegment[] | null)[] {
  const out: (IntralineSegment[] | null)[] = lines.map(() => null)
  let i = 0
  while (i < lines.length) {
    if (!lines[i].del) {
      i++
      continue
    }
    // Maximal run of deletions, then the run of additions that directly follows.
    let delEnd = i
    while (delEnd < lines.length && lines[delEnd].del) delEnd++
    let addEnd = delEnd
    while (addEnd < lines.length && lines[addEnd].add) addEnd++
    const pairs = Math.min(delEnd - i, addEnd - delEnd)
    for (let k = 0; k < pairs; k++) {
      const seg = segmentLinePair(lines[i + k].text, lines[delEnd + k].text)
      if (seg) {
        out[i + k] = seg.del
        out[delEnd + k] = seg.add
      }
    }
    i = addEnd > delEnd ? addEnd : delEnd
  }
  return out
}

/**
 * For each hunk, a parallel array (same length/order as `hunk.lines`) of intra-line
 * segment lists, or null where a line gets no word-level highlight (see
 * `pairIntralineSegments`).
 */
export function annotateIntralineChanges(hunks: DiffHunk[]): (IntralineSegment[] | null)[][] {
  return hunks.map((hunk) =>
    pairIntralineSegments(
      hunk.lines.map((l) => ({ del: l.type === 'del', add: l.type === 'add', text: l.text })),
    ),
  )
}

export type { DiffLine, DiffHunk }
