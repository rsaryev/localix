/**
 * Document → the flat list of fixed-height ROWS a virtualized diff mounts.
 *
 * Fixed heights per row kind are what make the virtualizer exact: every offset is a
 * prefix sum known before anything renders, so there is no measure-then-jump on a
 * large diff and `scrollToIndex` lands on the pixel. The sticky file/hunk overlay
 * reads `fileOf`/`hunkOf` for the top row instead of walking the DOM.
 *
 * Split rows zip a deletion with its `partner` addition — the same pairing the word
 * marks use — so a modify-in-place line and its marks share one row.
 */
import type { DiffDocument, DocFile } from './diffDocument'

export type DiffNote = 'binary' | 'large' | 'empty'

export type DiffRow =
  | { kind: 'file'; file: number }
  | { kind: 'note'; file: number; note: DiffNote }
  | { kind: 'hunk'; hunk: number }
  | { kind: 'line'; line: number }
  /** Split layout: old side, new side; -1 is the side with no counterpart. */
  | { kind: 'pair'; left: number; right: number }
  | { kind: 'meta'; line: number }

/**
 * Row heights in px at the 14px root — the chrome control ladder (`--chrome-control-md`
 * 28 / `-sm` 24 / `-xs` 20), so a diff header lines up with every other workbench row.
 */
export const DIFF_ROW_HEIGHT: Record<DiffRow['kind'], number> = {
  file: 28,
  note: 28,
  hunk: 24,
  line: 20,
  pair: 20,
  meta: 20,
}

/** A file this long starts collapsed in a multi-file diff (a "large diff" disclosure). */
export const LARGE_FILE_LINES = 1_500

export function isLargeFile(file: DocFile): boolean {
  return file.lineCount > LARGE_FILE_LINES
}

export interface DiffLayout {
  rows: DiffRow[]
  /** Prefix sums: `offsets[i]` is row i's top; `offsets[rows.length]` the total height. */
  offsets: Float64Array
  fileOf: Int32Array
  /** Hunk a row belongs to, or -1 (file headers, notes). */
  hunkOf: Int32Array
  /** Row index of each hunk header in document order (collapsed files skipped). */
  hunkRows: number[]
  /** Header row of a hunk by hunk id, or -1 (collapsed, or a header-less fragment). */
  hunkRowOf: Int32Array
  /** Row index of each file header; -1 when the layout has no file headers. */
  fileRows: number[]
}

export interface DiffLayoutOptions {
  split: boolean
  /** Render one header row per file (multi-file documents). */
  fileHeaders: boolean
  collapsed: ReadonlySet<number>
  /**
   * Root font size / 14. Text is sized in rem and follows the font-size setting;
   * px rows that did not follow it would clip a larger font, and the virtualizer's
   * offsets would disagree with the painted rows.
   */
  scale?: number
}

function pushHunkBody(
  doc: DiffDocument,
  hunkId: number,
  split: boolean,
  push: (row: DiffRow) => void,
): void {
  const hunk = doc.hunks[hunkId]!
  for (let id = hunk.lineStart; id < hunk.lineEnd; id++) {
    const line = doc.lines[id]!
    if (line.type === 'meta') push({ kind: 'meta', line: id })
    else if (!split) push({ kind: 'line', line: id })
    else if (line.type === 'ctx') push({ kind: 'pair', left: id, right: id })
    else if (line.type === 'del') push({ kind: 'pair', left: id, right: line.partner })
    // A paired addition already rode its deletion's row.
    else if (line.partner < 0) push({ kind: 'pair', left: -1, right: id })
  }
}

export function layoutDiffRows(doc: DiffDocument, options: DiffLayoutOptions): DiffLayout {
  const rows: DiffRow[] = []
  const files: number[] = []
  const hunksOf: number[] = []
  const hunkRows: number[] = []
  const hunkRowOf = new Int32Array(doc.hunks.length).fill(-1)
  const fileRows: number[] = []
  let file = 0
  let hunk = -1
  const push = (row: DiffRow) => {
    rows.push(row)
    files.push(file)
    hunksOf.push(hunk)
  }

  doc.files.forEach((docFile, fileId) => {
    file = fileId
    hunk = -1
    fileRows.push(options.fileHeaders ? rows.length : -1)
    if (options.fileHeaders) push({ kind: 'file', file: fileId })
    const collapsed = options.fileHeaders && options.collapsed.has(fileId)
    if (collapsed) {
      if (isLargeFile(docFile)) push({ kind: 'note', file: fileId, note: 'large' })
      return
    }
    if (docFile.binary && docFile.hunkEnd === docFile.hunkStart) {
      push({ kind: 'note', file: fileId, note: 'binary' })
      return
    }
    if (docFile.hunkEnd === docFile.hunkStart) {
      push({ kind: 'note', file: fileId, note: 'empty' })
      return
    }
    for (let hunkId = docFile.hunkStart; hunkId < docFile.hunkEnd; hunkId++) {
      hunk = hunkId
      // A header-less fragment has no `@@` to show, only its body.
      if (doc.hunks[hunkId]!.header) {
        hunkRowOf[hunkId] = rows.length
        hunkRows.push(rows.length)
        push({ kind: 'hunk', hunk: hunkId })
      }
      pushHunkBody(doc, hunkId, options.split, push)
    }
  })

  const scale = options.scale ?? 1
  const offsets = new Float64Array(rows.length + 1)
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = offsets[i]! + Math.round(DIFF_ROW_HEIGHT[rows[i]!.kind] * scale)
  }
  return {
    rows,
    offsets,
    fileOf: Int32Array.from(files),
    hunkOf: Int32Array.from(hunksOf),
    hunkRows,
    hunkRowOf,
    fileRows,
  }
}

/** Index of the row covering vertical offset `y` (binary search over the prefix sums). */
export function rowAt(layout: DiffLayout, y: number): number {
  const { offsets } = layout
  let lo = 0
  let hi = layout.rows.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}
