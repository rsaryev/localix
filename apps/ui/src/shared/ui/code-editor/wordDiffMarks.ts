import { parseUnifiedDiff } from '../diff/parseUnifiedDiff'
import { annotateIntralineChanges } from '../diff/intralineDiff'

/**
 * Unobtrusive word-level change highlighting in the OPEN editor. The thin
 * `dirtyDiffGutter` bar already marks WHICH lines changed vs git `HEAD`; this
 * companion narrows the eye to WHAT changed inside a modified line — only the
 * changed character spans get a faint tint, not a full-line wash.
 *
 * Fed by the SAME `git diff HEAD` string the gutter consumes. The changed spans
 * are computed by PURE, tested functions that REUSE the existing diff primitives
 * (`parseUnifiedDiff` + `annotateIntralineChanges`, the word-diff engine shared
 * with the DiffView surfaces) — no parallel diff/word-diff implementation lives
 * here. Marks are anchored to the file on disk (recomputed on load + after each
 * save); between saves in-buffer edits drift the positions (the decorations map
 * through those edits, and out-of-range marks degrade gracefully) until the next
 * save re-anchors them — the same caveat the gutter documents.
 */

/**
 * One changed character span on a modified line, in the MODIFIED (current-file)
 * coordinate space. `from`/`to` are 0-based character offsets WITHIN the line.
 */
export interface WordDiffMark {
  /** 1-based line number in the modified file. */
  line: number
  from: number
  to: number
}

/**
 * Compute per-modified-line changed-span marks from a unified `git diff HEAD`
 * string. Pure + self-contained so it can be unit-tested without Monaco.
 *
 * Only ADDED lines (the ones present in the current buffer) carry marks: the
 * shared word-diff engine pairs each deleted line with its following added line
 * and flags the intra-line changed segments; we walk the ADD side's segments,
 * accumulating character offsets so each changed run becomes a `{line,from,to}`
 * range in the new-file coordinate space. Whole-line rewrites (no shared text)
 * produce no marks — the gutter strip already tells that story.
 */
export function computeWordDiffMarks(diff: string): WordDiffMark[] {
  const marks: WordDiffMark[] = []
  if (!diff) return marks
  const hunks = parseUnifiedDiff(diff)
  const perHunk = annotateIntralineChanges(hunks)
  hunks.forEach((hunk, hi) => {
    const segsPerLine = perHunk[hi]
    hunk.lines.forEach((line, idx) => {
      if (line.type !== 'add' || line.newNo === undefined) return
      const segs = segsPerLine[idx]
      if (!segs) return
      let col = 0
      for (const seg of segs) {
        const len = seg.text.length
        if (seg.changed && len > 0) marks.push({ line: line.newNo, from: col, to: col + len })
        col += len
      }
    })
  })
  return marks
}
