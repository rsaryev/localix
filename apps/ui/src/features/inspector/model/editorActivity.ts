/**
 * Same-file edit-history tracker feeding edit prediction. After the user edits, a
 * small whole-line window around the change is recorded (with the pre-edit content,
 * so the backend can render a before→after diff); `getFileEditHistory` returns THIS
 * file's recent windows as the "events" signal. Keyed by absolute path, so a file in
 * another session's sandbox (a different path) never collides.
 *
 * Plain module functions over a tiny store — `recordEdit` is a write-only hot path
 * (called on every keystroke), so it avoids React re-renders.
 */

import { create } from 'zustand'

const EDIT_WINDOW = 2 // ± lines captured around an edit
const MAX_EDITED = 3
const EDIT_TTL_MS = 2 * 60 * 1000

export interface EditedRange {
  filepath: string
  startLine: number // 0-based, inclusive
  endLine: number // 0-based, inclusive
  /** The window's content BEFORE the edits started (origin snapshot) — the baseline
   *  the backend diffs `lines` against to show what the developer just changed. */
  before: string[]
  lines: string[]
  ts: number
}

interface ActivityState {
  edited: EditedRange[]
  set: (patch: Partial<ActivityState>) => void
}

const useActivityStore = create<ActivityState>((set) => ({
  edited: [],
  set: (patch) => set(patch),
}))

/**
 * The lines `[start, end]` (0-based, inclusive, clamped to the document) of `content`.
 *
 * Deliberately NOT `content.split('\n').slice(...)`: this is called on every keystroke,
 * and splitting allocates one string per line of the WHOLE file to then throw all but
 * ~5 of them away. Walking newline offsets touches at most the bytes up to `end` and
 * allocates only the lines asked for. The result is identical to the split-and-slice,
 * including the trailing `''` a document ending in a newline produces.
 */
export function sliceLines(content: string, start: number, end: number): string[] {
  if (start < 0 || end < start) return []
  let offset = 0
  for (let line = 0; line < start; line++) {
    const next = content.indexOf('\n', offset)
    if (next === -1) return [] // `start` is past the last line
    offset = next + 1
  }
  const lines: string[] = []
  for (let line = start; line <= end; line++) {
    const next = content.indexOf('\n', offset)
    if (next === -1) {
      lines.push(content.slice(offset)) // last line, no trailing newline
      return lines
    }
    lines.push(content.slice(offset, next))
    offset = next + 1
  }
  return lines
}

/** Line count, without materializing the lines. Only needed on the degenerate path
 *  where the window starts past the end of a (just-shrunk) document. */
function countLines(content: string): number {
  let count = 1
  let offset = 0
  for (;;) {
    const next = content.indexOf('\n', offset)
    if (next === -1) return count
    count++
    offset = next + 1
  }
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart <= bEnd && bStart <= aEnd

/** Merge a new edit window into the edited list: drop stale (TTL vs `now`), fold any
 *  overlapping same-file window into the new one (widening the span + reslicing the
 *  current content, preserving the origin `before`), cap at MAX_EDITED, newest first.
 *  Pure — `now` is injected so the merge + TTL logic is unit-testable without a clock. */
export function mergeEditedRanges(
  edited: EditedRange[],
  filepath: string,
  prevContent: string,
  content: string,
  line: number,
  now: number,
): EditedRange[] {
  // The window's own lines double as its clamp: the slice stops at the last line, so
  // its length says where the document ended — no line count (and no full split) needed
  // unless the window starts past the end of a document that just shrank.
  const winStart = Math.max(0, line - EDIT_WINDOW)
  const winLines = sliceLines(content, winStart, line + EDIT_WINDOW)
  const winEnd = winLines.length > 0 ? winStart + winLines.length - 1 : countLines(content) - 1
  let startLine = winStart
  let endLine = winEnd
  let widened = false
  let before: string[] = sliceLines(prevContent, winStart, winEnd)
  const rest = edited.filter((e) => {
    if (now - e.ts >= EDIT_TTL_MS) return false
    if (e.filepath === filepath && overlaps(e.startLine, e.endLine, winStart, winEnd)) {
      if (e.startLine < startLine) {
        startLine = e.startLine
        widened = true
      }
      if (e.endLine > endLine) {
        endLine = e.endLine
        widened = true
      }
      before = e.before // preserve the ORIGIN — before→after spans the whole burst
      return false
    }
    return true
  })
  let lines = winLines
  if (widened) {
    lines = sliceLines(content, startLine, endLine)
    endLine = lines.length > 0 ? startLine + lines.length - 1 : countLines(content) - 1
  }
  const entry: EditedRange = {
    filepath,
    startLine,
    endLine,
    before,
    lines,
    ts: now,
  }
  return [entry, ...rest].slice(0, MAX_EDITED)
}

/** Record an edit: capture a small whole-line window around the edited line, with the
 *  pre-edit content (`prevContent`) so the backend can render a before→after diff. */
export function recordEdit(
  filepath: string,
  prevContent: string,
  content: string,
  line: number,
): void {
  if (!filepath) return
  const { edited, set } = useActivityStore.getState()
  set({ edited: mergeEditedRanges(edited, filepath, prevContent, content, line, Date.now()) })
}

/**
 * Recent edit windows for ONE file (the next-edit-prediction "events" signal). Returns
 * the TTL-fresh line windows for `filepath`, newest first, each with its 1-based
 * inclusive line range so the backend events log can say WHERE the edit was, and its
 * pre-edit `before` snapshot for the before→after diff. Keyed by exact path.
 */
export function getFileEditHistory(
  filepath: string,
): { before: string[]; lines: string[]; startLine: number; endLine: number }[] {
  const now = Date.now()
  return useActivityStore
    .getState()
    .edited.flatMap((e) =>
      now - e.ts < EDIT_TTL_MS && e.filepath === filepath
        ? [{ before: e.before, lines: e.lines, startLine: e.startLine + 1, endLine: e.endLine + 1 }]
        : [],
    )
}
