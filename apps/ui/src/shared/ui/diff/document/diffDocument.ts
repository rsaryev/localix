/**
 * The diff DOCUMENT: every file, hunk and line of a (possibly multi-file) patch in
 * three flat arrays, addressed by integer ids.
 *
 * The defect this shape stops: the old surfaces kept a nested hunks→lines tree per
 * file and derived everything else (highlight HTML, word marks, split rows, stats)
 * eagerly over the whole patch, so opening a lockfile or a 300-file commit paid for
 * every line before the first one could paint. With flat ids, the renderer can look
 * up exactly the lines that are on screen, and per-line caches are plain arrays
 * indexed by line id instead of nested maps.
 *
 * Built once per patch; everything here is pure and framework-free.
 */
import type { DiffLineType } from '../parseUnifiedDiff'

/** One body line as a producer hands it in (a parsed patch, or a staging view's fetched lines). */
export interface DiffLineInput {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
  /** Opaque producer key (e.g. the raw-diff index a line-staging op sends back). */
  key?: number
}

export interface DiffHunkInput {
  /** Verbatim `@@ -a,b +c,d @@ context` header; empty for a header-less fragment. */
  header: string
  lines: DiffLineInput[]
}

export interface DiffFileInput {
  /** Repo-relative (or absolute) path; empty for an anonymous single-file fragment. */
  path: string
  hunks: DiffHunkInput[]
  deleted?: boolean
  added?: boolean
  binary?: boolean
  /** Short label a producer wants beside the path (e.g. "new", "rename"). */
  badge?: string
}

export interface DocFile {
  path: string
  deleted: boolean
  added: boolean
  binary: boolean
  badge?: string
  additions: number
  deletions: number
  /** Body lines (context + changes) — the size a disclosure default is decided on. */
  lineCount: number
  /** First new-file line a change lands on, for "open at first change". */
  firstLine?: number
  hunkStart: number
  hunkEnd: number
}

export interface DocHunk {
  file: number
  header: string
  lineStart: number
  lineEnd: number
}

export interface DocLine {
  type: DiffLineType
  text: string
  oldNo?: number
  newNo?: number
  key?: number
  hunk: number
  /**
   * The line on the other side of a modify-in-place pair (a deletion run zipped
   * index-by-index with the addition run that follows it), or -1. The same
   * topology drives the word marks AND the split-row pairing, so a pair's marks
   * always line up on one split row.
   */
  partner: number
  /** Change run this add/del line belongs to, or -1 for context/meta. */
  run: number
  /** Display width in columns (tabs count as 4) — sizes the horizontal canvas. */
  cols: number
}

/** A maximal block of consecutive add/del lines inside one hunk — the unit a block action acts on. */
export interface DocRun {
  hunk: number
  lineStart: number
  lineEnd: number
}

export interface DiffDocument {
  files: DocFile[]
  hunks: DocHunk[]
  lines: DocLine[]
  runs: DocRun[]
  additions: number
  deletions: number
  /** Widest line in columns, clamped by the render cap. */
  maxCols: number
  /** Largest old/new line number — sizes the gutter so 5-digit numbers never overflow it. */
  maxLineNo: number
}

/** Past this many columns a line renders as plain text, uncapped work would stall a frame. */
export const LONG_LINE_COLS = 1_000
/** Characters of a single line actually mounted; the rest is summarised, never silently cut. */
export const RENDER_LINE_CHARS = 10_000

function displayCols(text: string): number {
  if (text.length > RENDER_LINE_CHARS) return RENDER_LINE_CHARS + 24
  let cols = 0
  for (let i = 0; i < text.length; i++) cols += text.charCodeAt(i) === 9 ? 4 : 1
  return cols
}

/** Zip each deletion run with the addition run that directly follows it (ids are global). */
function pairRuns(lines: DocLine[], start: number, end: number): void {
  let i = start
  while (i < end) {
    if (lines[i]!.type !== 'del') {
      i++
      continue
    }
    let delEnd = i
    while (delEnd < end && lines[delEnd]!.type === 'del') delEnd++
    let addEnd = delEnd
    while (addEnd < end && lines[addEnd]!.type === 'add') addEnd++
    const pairs = Math.min(delEnd - i, addEnd - delEnd)
    for (let k = 0; k < pairs; k++) {
      lines[i + k]!.partner = delEnd + k
      lines[delEnd + k]!.partner = i + k
    }
    i = Math.max(addEnd, delEnd)
  }
}

export function buildDiffDocument(inputs: readonly DiffFileInput[]): DiffDocument {
  const doc: DiffDocument = {
    files: [],
    hunks: [],
    lines: [],
    runs: [],
    additions: 0,
    deletions: 0,
    maxCols: 0,
    maxLineNo: 0,
  }
  for (const input of inputs) {
    const fileId = doc.files.length
    const file: DocFile = {
      path: input.path,
      deleted: input.deleted === true,
      added: input.added === true,
      binary: input.binary === true,
      badge: input.badge,
      additions: 0,
      deletions: 0,
      lineCount: 0,
      hunkStart: doc.hunks.length,
      hunkEnd: doc.hunks.length,
    }
    for (const hunkInput of input.hunks) {
      const hunkId = doc.hunks.length
      const lineStart = doc.lines.length
      let openRun = -1
      for (const line of hunkInput.lines) {
        const change = line.type === 'add' || line.type === 'del'
        if (change && openRun < 0) {
          openRun = doc.runs.length
          doc.runs.push({ hunk: hunkId, lineStart: doc.lines.length, lineEnd: doc.lines.length })
        } else if (!change) openRun = -1
        const cols = displayCols(line.text)
        if (cols > doc.maxCols) doc.maxCols = cols
        const lineNo = Math.max(line.oldNo ?? 0, line.newNo ?? 0)
        if (lineNo > doc.maxLineNo) doc.maxLineNo = lineNo
        doc.lines.push({ ...line, hunk: hunkId, partner: -1, run: openRun, cols })
        if (openRun >= 0) doc.runs[openRun]!.lineEnd = doc.lines.length
        if (line.type === 'add') {
          file.additions++
          if (file.firstLine === undefined && line.newNo) file.firstLine = line.newNo
        } else if (line.type === 'del') file.deletions++
        if (line.type !== 'meta') file.lineCount++
      }
      pairRuns(doc.lines, lineStart, doc.lines.length)
      doc.hunks.push({
        file: fileId,
        header: hunkInput.header,
        lineStart,
        lineEnd: doc.lines.length,
      })
    }
    file.hunkEnd = doc.hunks.length
    if (file.firstLine === undefined && !file.deleted && file.hunkEnd > file.hunkStart) {
      // An all-deletion edit still has a new-file place to land: its first surviving line.
      const end = doc.hunks[file.hunkEnd - 1]!.lineEnd
      for (let id = doc.hunks[file.hunkStart]!.lineStart; id < end; id++) {
        const newNo = doc.lines[id]!.newNo
        if (newNo !== undefined) {
          file.firstLine = newNo
          break
        }
      }
    }
    doc.additions += file.additions
    doc.deletions += file.deletions
    doc.files.push(file)
  }
  return doc
}
