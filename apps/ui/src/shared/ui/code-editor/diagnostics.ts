/**
 * A diagnostic in LSP coordinates (0-based line/character), kept deliberately
 * decoupled from the backend `LspDiagnostic` type so this primitive imports
 * nothing from `features`. The feature wrapper converts LSP → this shape.
 */
export interface EditorDiagnostic {
  line: number
  character: number
  endLine: number
  endCharacter: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string
  /** Server rule identifier, e.g. `2304` — rendered as `source(code)` (`ts(2304)`). */
  code?: string | number
  /**
   * How the span itself is drawn, beyond its squiggle: `unnecessary` fades it (an unused
   * variable, import, parameter, unreachable code), `deprecated` strikes it through.
   */
  tags?: EditorDiagnosticTag[]
}

export type EditorDiagnosticTag = 'unnecessary' | 'deprecated'

/**
 * `source(code)` label for a diagnostic (e.g. `ts(2304)`, `eslint`,
 * or a bare `2304`). Returns `undefined` when neither is present. Shared by the
 * editor lint tooltip and the Problems panel so both read identically.
 */
export function formatDiagnosticSource(
  source?: string,
  code?: string | number,
): string | undefined {
  const c = code === undefined || code === null || code === '' ? undefined : String(code)
  if (source && c) return `${source}(${c})`
  return source || c
}
