/** The part of a text model the reveal math needs. */
export interface LineBounds {
  getLineCount(): number
  getLineMaxColumn(lineNumber: number): number
}

export interface RevealRequest {
  /** 1-based line. */
  line?: number
  /** 0-based column. */
  column?: number
  endLine?: number
  endColumn?: number
}

export interface RevealSelection {
  lineNumber: number
  column: number
  endLineNumber: number
  endColumn: number
}

/** Clamps a requested reveal (1-based lines, 0-based columns) to a Monaco selection, or null. */
export function revealSelection(model: LineBounds, request: RevealRequest): RevealSelection | null {
  const { line, column: col, endLine, endColumn: endCol } = request
  if (!line || line < 1) return null
  const lineNumber = Math.min(line, model.getLineCount())
  const column = Math.min(Math.max((col ?? 0) + 1, 1), model.getLineMaxColumn(lineNumber))
  const endLineNumber = Math.min(Math.max(endLine ?? lineNumber, lineNumber), model.getLineCount())
  const endColumn = endLine
    ? Math.min(Math.max((endCol ?? 0) + 1, 1), model.getLineMaxColumn(endLineNumber))
    : column
  return { lineNumber, column, endLineNumber, endColumn }
}

/** Clamps a saved view-state snapshot (0-based column) to the current model. */
export function restoredPosition(
  model: LineBounds,
  snapshot: { line: number; column: number; top: number },
): { lineNumber: number; column: number; top: number } {
  const lineCount = model.getLineCount()
  const lineNumber = Math.min(Math.max(snapshot.line, 1), lineCount)
  const column = Math.min(Math.max(snapshot.column + 1, 1), model.getLineMaxColumn(lineNumber))
  return { lineNumber, column, top: Math.min(Math.max(snapshot.top, 1), lineCount) }
}
