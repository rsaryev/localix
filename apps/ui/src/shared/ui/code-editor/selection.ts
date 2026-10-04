import type { EditorTextSelection } from './types'

export interface EditorSelectionPoint {
  line: number
  column: number
}

function pointPrecedes(left: EditorSelectionPoint, right: EditorSelectionPoint): boolean {
  return left.line < right.line || (left.line === right.line && left.column <= right.column)
}

/** Normalize anchor/active positions so backward selections produce ascending metadata. */
export function normalizeEditorSelection(
  anchor: EditorSelectionPoint,
  active: EditorSelectionPoint,
  text: string,
): EditorTextSelection | null {
  if (anchor.line === active.line && anchor.column === active.column) return null
  const [start, end] = pointPrecedes(anchor, active) ? [anchor, active] : [active, anchor]
  return {
    text,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}
