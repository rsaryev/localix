import type { WordDiffMark } from './wordDiffMarks'

/**
 * Quick-diff gutter: colored per-line change markers against the last commit
 * (git `HEAD`), the way native IDEs mark uncommitted edits in the editor margin
 * (a "dirty diff"). The biggest daily win for an
 * agentic development environment: when an agent rewrites a file, you open it and instantly see which
 * lines it added / changed / deleted while reading, not only in a separate diff tab.
 *
 * Adapted — not ported — to Localix: the change model is derived from a plain
 * unified-diff string by a PURE, tested function (`parseUnifiedDiff`), so the
 * editor primitive stays backend-free (it never talks to git; the feature layer
 * fetches the diff and feeds it in). Markers are anchored to the file on disk
 * (recomputed on load + after each save); between saves the line positions of
 * in-buffer edits drift until the next save re-anchors them.
 */

export type DirtyChangeType = 'added' | 'modified' | 'deleted'

/**
 * Which of a provider's two change LAYERS a line belongs to, or both.
 *
 * The editor draws two weights and nothing more: `primary` and `both` render FILLED, `secondary`
 * renders HOLLOW (outlined + faint fill). What the two layers MEAN is the provider's — for a git
 * provider they are the index and the working tree, and a line in both is one that was recorded
 * and then edited again. Undefined ⇒ the provider offered no distinction; the bar renders solid.
 */
export type DirtyChangeLayer = 'primary' | 'secondary' | 'both'

export interface DirtyChange {
  /**
   * 1-based first line of the change in the MODIFIED (current file) coordinate
   * space. For a pure deletion this is the surviving line the removed content sat
   * above (the wedge marker is drawn at its top edge).
   */
  fromLine: number
  /** 1-based last line (inclusive). Equals `fromLine` for a deletion. */
  toLine: number
  type: DirtyChangeType
  /** Which layer, or both. Absent ⇒ render solid (the provider drew no distinction). */
  layer?: DirtyChangeLayer
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse a unified diff (git `diff HEAD -- <file>` output) into typed line-change
 * ranges in the modified file's coordinate space. Pure and self-contained so it
 * can be unit-tested without an editor or a repo.
 *
 * Runs of consecutive non-context lines are collapsed into one change: removals
 * with additions → `modified`, additions only → `added`, removals only →
 * `deleted` (anchored to the surviving line below the removal).
 */
export function parseUnifiedDiff(diff: string): DirtyChange[] {
  const changes: DirtyChange[] = []
  if (!diff) return changes
  const lines = diff.split('\n')

  let newLine = 0 // next modified line number a context/'+' line will occupy
  let inHunk = false
  // Current run of non-context lines.
  let runAddStart = 0
  let addCount = 0
  let delCount = 0

  const flushRun = () => {
    if (addCount === 0 && delCount === 0) return
    if (addCount > 0) {
      changes.push({
        fromLine: runAddStart,
        toLine: runAddStart + addCount - 1,
        type: delCount > 0 ? 'modified' : 'added',
      })
    } else {
      // Pure deletion: mark the surviving line below the removed block (the line
      // now at `runAddStart`), or line 1 when the removal was at the very top.
      const anchor = Math.max(runAddStart - 1, 1)
      changes.push({ fromLine: anchor, toLine: anchor, type: 'deleted' })
    }
    addCount = 0
    delCount = 0
  }

  for (const raw of lines) {
    const hunk = HUNK_RE.exec(raw)
    if (hunk) {
      flushRun()
      newLine = Number(hunk[1])
      inHunk = true
      continue
    }
    if (!inHunk) continue // file headers (---/+++/diff/index) before the first hunk
    const marker = raw[0]
    if (marker === '\\') continue // "\ No newline at end of file"
    if (marker === '+') {
      if (addCount === 0 && delCount === 0) runAddStart = newLine
      else if (addCount === 0) runAddStart = newLine // first '+' after some '-'
      addCount++
      newLine++
    } else if (marker === '-') {
      if (addCount === 0 && delCount === 0) runAddStart = newLine
      delCount++
    } else {
      // Context line (' ') or an unexpected line ends the current run.
      flushRun()
      if (marker === ' ') newLine++
      else inHunk = false // left the hunk body
    }
  }
  flushRun()
  return changes
}

/**
 * Merge a provider's two change layers — both already parsed into `DirtyChange[]` in the current
 * file's coordinate space — into one layer-tagged list, so the gutter can distinguish two depths
 * of pending change.
 *
 * A line only in `primary` → `primary`; only in `secondary` → `secondary`; in both → `both`. Pure
 * and self-contained, so it is testable without an editor or a provider.
 *
 * Coordinate note: the two layers may number their lines in DIFFERENT spaces (for a git provider,
 * the index and the working tree), and when a file has changes in both those spaces can diverge —
 * so a primary bar may sit a line or two off in that mixed case. A file whose change lives in one
 * layer only, which is the common state, lines up exactly.
 */
export function mergeDirtyChanges(primary: DirtyChange[], secondary: DirtyChange[]): DirtyChange[] {
  interface Cell {
    type: DirtyChangeType
    inPrimary: boolean
    inSecondary: boolean
  }
  const cells = new Map<number, Cell>()
  const absorb = (changes: DirtyChange[], side: 'primary' | 'secondary') => {
    for (const c of changes) {
      for (let ln = c.fromLine; ln <= c.toLine; ln++) {
        const prev = cells.get(ln)
        cells.set(ln, {
          type: mergeChangeType(prev?.type, c.type),
          inPrimary: (prev?.inPrimary ?? false) || side === 'primary',
          inSecondary: (prev?.inSecondary ?? false) || side === 'secondary',
        })
      }
    }
  }
  absorb(primary, 'primary')
  absorb(secondary, 'secondary')

  const out: DirtyChange[] = []
  for (const ln of [...cells.keys()].sort((a, b) => a - b)) {
    const cell = cells.get(ln)!
    const layer: DirtyChangeLayer =
      cell.inPrimary && cell.inSecondary ? 'both' : cell.inPrimary ? 'primary' : 'secondary'
    const last = out[out.length - 1]
    // Coalesce consecutive lines of the same type+layer into one run; keep every
    // deletion wedge on its own anchor line (never merged into a run).
    if (
      last?.toLine === ln - 1 &&
      last.type === cell.type &&
      last.layer === layer &&
      cell.type !== 'deleted'
    ) {
      last.toLine = ln
    } else {
      out.push({ fromLine: ln, toLine: ln, type: cell.type, layer })
    }
  }
  return out
}

/**
 * Reconcile the change type when both diffs touch the same line: a real content
 * change (`added`/`modified`) always supersedes a deletion anchor, and any
 * `modified` beats a plain `added` (a mix of insert + change reads as modified).
 */
function mergeChangeType(
  prev: DirtyChangeType | undefined,
  next: DirtyChangeType,
): DirtyChangeType {
  if (!prev) return next
  if (prev === 'deleted') return next
  if (next === 'deleted') return prev
  return prev === 'modified' || next === 'modified' ? 'modified' : 'added'
}

/**
 * Pre-computed editor quick-diff feed: the layer-tagged gutter `changes` plus the
 * word-level `wordMarks`, both derived by whoever provides the change layers. The editor stays a
 * dumb consumer — it just dispatches these
 * into `setDirtyChanges` / `setWordDiffMarks`, doing no git parsing itself.
 */
export interface DirtyDiffFeed {
  changes: DirtyChange[]
  wordMarks: WordDiffMark[]
}
